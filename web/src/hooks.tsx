import { useState, useCallback } from 'react';

export function useToast() {
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({
    message: '',
    visible: false,
  });

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => setToast({ message: '', visible: false }), 2000);
  }, []);

  const ToastComponent = toast.visible ? (
    <div className="toast toast-success">{toast.message}</div>
  ) : null;

  return { showToast, ToastComponent };
}
