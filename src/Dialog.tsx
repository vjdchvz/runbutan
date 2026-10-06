import { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export type DialogOptions = {
  title: string;
  highlight?: string; // big readout, e.g. "2.41 km · 14:32"
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string; // omit for a single-button (info) dialog
  danger?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void; // only for the cancel BUTTON; tapping outside / Back just closes
};

// Themed replacement for Alert.alert so dialogs match the app instead of the stock Android look.
export function useDialog() {
  const [opts, setOpts] = useState<DialogOptions>({ title: '' });
  const [visible, setVisible] = useState(false);
  const showDialog = useCallback((o: DialogOptions) => {
    setOpts(o);
    setVisible(true);
  }, []);
  const close = () => setVisible(false);
  const confirm = () => {
    close();
    opts.onConfirm?.();
  };

  const dialog = (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{opts.title}</Text>
          {!!opts.highlight && <Text style={styles.highlight}>{opts.highlight}</Text>}
          {!!opts.message && <Text style={styles.message}>{opts.message}</Text>}
          <View style={styles.row}>
            {!!opts.cancelLabel && (
              <Pressable
                style={[styles.btn, styles.cancel]}
                onPress={() => {
                  close();
                  opts.onCancel?.();
                }}
              >
                <Text style={styles.btnText}>{opts.cancelLabel}</Text>
              </Pressable>
            )}
            <Pressable style={[styles.btn, opts.danger ? styles.danger : styles.primary]} onPress={confirm}>
              <Text style={styles.btnText}>{opts.confirmLabel ?? 'OK'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
  return { dialog, showDialog };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', paddingHorizontal: 24 },
  card: { backgroundColor: '#17171F', borderRadius: 22, padding: 22, borderWidth: 1, borderColor: '#26262F' },
  title: { color: '#fff', fontSize: 22, fontWeight: '900' },
  highlight: { color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 14, fontVariant: ['tabular-nums'] },
  message: { color: '#8A8A96', fontSize: 15, marginTop: 8, lineHeight: 21 },
  row: { flexDirection: 'row', gap: 10, marginTop: 22 },
  btn: { flex: 1, paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  cancel: { backgroundColor: '#2A2A35' },
  primary: { backgroundColor: '#FF4D2E' },
  danger: { backgroundColor: '#E02030' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
});
