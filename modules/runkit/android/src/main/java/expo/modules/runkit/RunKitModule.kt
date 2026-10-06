package expo.modules.runkit

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
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
