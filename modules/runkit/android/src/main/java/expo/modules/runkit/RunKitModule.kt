package expo.modules.runkit

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ContentValues
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Environment
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Two small Android things the JS side cannot do:
 *  - audio focus "duck" while the coach speaks, so music gets quieter instead of talking over the voice
 *  - a rich, live "run in progress" notification with Pause / Stop buttons (works from the lock screen)
 */
class RunKitModule : Module() {
  private val context: Context get() = requireNotNull(appContext.reactContext)
  private var focus: AudioFocusRequest? = null
  private var receiver: BroadcastReceiver? = null

  private fun vibrator(): Vibrator? =
    if (Build.VERSION.SDK_INT >= 31) {
      (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

  private val actionToggle get() = "${context.packageName}.action.TOGGLE"
  private val actionStop get() = "${context.packageName}.action.STOP"

  override fun definition() = ModuleDefinition {
    Name("RunKit")
    Events("onAction")

    OnCreate {
      val r = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) {
          val action = when (i?.action) {
            actionToggle -> "toggle"
            actionStop -> "stop"
            else -> return
          }
          sendEvent("onAction", mapOf("action" to action))
        }
      }
      val filter = IntentFilter().apply {
        addAction(actionToggle)
        addAction(actionStop)
      }
      if (Build.VERSION.SDK_INT >= 33) {
        context.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        context.registerReceiver(r, filter)
      }
      receiver = r
    }

    OnDestroy {
      receiver?.let { runCatching { context.unregisterReceiver(it) } }
      receiver = null
    }

    // ---- audio ducking ----
    Function("requestDuck") {
      if (Build.VERSION.SDK_INT < 26) return@Function false
      val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val req = focus ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setOnAudioFocusChangeListener { }
        .build()
        .also { focus = it }
      am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    Function("abandonDuck") {
      if (Build.VERSION.SDK_INT >= 26) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        focus?.let { am.abandonAudioFocusRequest(it) }
      }
    }

    // ---- cadence beat ----
    // One repeating waveform handed to the system vibrator: Android replays it on its own, so the beat
    // keeps going with the screen off or the app in the background (a JS timer gets paused there).
    // Alarm usage: the vibrator lets alarm-type vibrations continue for background apps.
    Function("startBeat") { bpm: Int ->
      if (Build.VERSION.SDK_INT < 26) return@Function false
      val v = vibrator() ?: return@Function false
      val period = (60000L / bpm.coerceIn(60, 240)).coerceAtLeast(120L)
      val pulse = 35L
      val effect = VibrationEffect.createWaveform(longArrayOf(0, pulse, period - pulse), 0)
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      v.cancel()
      v.vibrate(effect, attrs)
      true
    }

    Function("stopBeat") { vibrator()?.cancel() }

    // ---- save a text file into the phone's public Downloads folder (no permission needed on Android 10+) ----
    AsyncFunction("saveToDownloads") { name: String, content: String, mime: String ->
      if (Build.VERSION.SDK_INT < 29) throw IllegalStateException("Saving to Downloads needs Android 10 or newer")
      val resolver = context.contentResolver
      val dot = name.lastIndexOf('.')
      val stem = if (dot > 0) name.substring(0, dot) else name
      val ext = if (dot > 0) name.substring(dot) else ""

      // Android renames a clash to "name.gpx (1)", which loses the .gpx ending that websites look for.
      // So: first remove this app's own earlier copy of the same name, and if the name is still taken
      // (e.g. a file from another app), try name-2.gpx, name-3.gpx ... ourselves.
      runCatching {
        resolver.delete(
          MediaStore.Downloads.EXTERNAL_CONTENT_URI,
          "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?",
          arrayOf(name, "${Environment.DIRECTORY_DOWNLOADS}%")
        )
      }

      var saved: String? = null
      for (attempt in 1..10) {
        val candidate = if (attempt == 1) name else "$stem-$attempt$ext"
        val values = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, candidate)
          put(MediaStore.MediaColumns.MIME_TYPE, mime)
          put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
          ?: throw IllegalStateException("Could not create the file in Downloads")
        var finalName = candidate
        resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use {
          if (it.moveToFirst()) finalName = it.getString(0)
        }
        if (finalName != candidate) {
          runCatching { resolver.delete(uri, null, null) } // got renamed: discard and try the next name
          continue
        }
        try {
          resolver.openOutputStream(uri)?.use { it.write(content.toByteArray(Charsets.UTF_8)) }
            ?: throw IllegalStateException("Could not open the file for writing")
        } catch (e: Exception) {
          runCatching { resolver.delete(uri, null, null) } // never leave an empty file behind
          throw e
        }
        saved = finalName
        break
      }
      saved ?: throw IllegalStateException("Could not find a free file name in Downloads")
    }

    // ---- copy an image file into the phone's gallery (Pictures/RUNbutan), no permission needed on Android 10+ ----
    AsyncFunction("saveImageToGallery") { path: String, name: String ->
      if (Build.VERSION.SDK_INT < 29) throw IllegalStateException("Saving to the gallery needs Android 10 or newer")
      val file = java.io.File(path.removePrefix("file://"))
      if (!file.exists()) throw IllegalStateException("The image file was not found")
      val resolver = context.contentResolver
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
        put(MediaStore.MediaColumns.MIME_TYPE, "image/png")
        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/RUNbutan")
      }
      val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        ?: throw IllegalStateException("Could not create the image in the gallery")
      try {
        resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
          ?: throw IllegalStateException("Could not open the image for writing")
      } catch (e: Exception) {
        runCatching { resolver.delete(uri, null, null) }
        throw e
      }
      name
    }

    Function("cancelRunNotification") { cancelOurs() }

    // ---- run notification (replaces the plain "tracking" one the location service posts) ----
    Function("showRunNotification") { title: String, text: String, paused: Boolean, stopArmed: Boolean ->
      if (Build.VERSION.SDK_INT < 26) return@Function
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(CHANNEL) == null) {
        nm.createNotificationChannel(
          NotificationChannel(CHANNEL, "Run in progress", NotificationManager.IMPORTANCE_LOW).apply {
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setShowBadge(false)
          }
        )
      }
      // Reuse the id of the foreground-service notification so there is only ONE notification.
      val id = runCatching {
        nm.activeNotifications.firstOrNull { it.notification.flags and Notification.FLAG_FOREGROUND_SERVICE != 0 }?.id
      }.getOrNull() ?: FALLBACK_ID

      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
      }
      val b = Notification.Builder(context, CHANNEL)
        .setSmallIcon(android.R.drawable.ic_menu_mylocation)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setColor(0xFFFF4D2E.toInt())
        .setCategory(Notification.CATEGORY_SERVICE)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .addAction(
          Notification.Action.Builder(
            Icon.createWithResource(context, if (paused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause),
            if (paused) "Resume" else "Pause",
            broadcast(actionToggle, 1)
          ).build()
        )
        .addAction(
          Notification.Action.Builder(
            Icon.createWithResource(context, android.R.drawable.ic_menu_close_clear_cancel),
            if (stopArmed) "Tap again to STOP" else "Stop",
            broadcast(actionStop, 2)
          ).build()
        )
      launch?.let {
        b.setContentIntent(PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      }
      if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
      nm.notify(id, b.build())
    }
  }

  private fun cancelOurs() {
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      runCatching {
        nm.activeNotifications.filter { it.notification.channelId == CHANNEL }.forEach { nm.cancel(it.id) }
      }
    }
  }

  private fun broadcast(action: String, code: Int): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      code,
      Intent(action).setPackage(context.packageName),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

  companion object {
    private const val CHANNEL = "runbutan_run"
    private const val FALLBACK_ID = 481756
  }
}
