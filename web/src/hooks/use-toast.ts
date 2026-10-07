import * as React from "react";
import type { ToastActionElement, ToastProps } from "@/components/ui/toast";

const TOAST_LIMIT = 4;
const TOAST_REMOVE_DELAY = 5000;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

type Toast = Omit<ToasterToast, "id">;

let count = 0;
function nextId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

const listeners: Array<(toasts: ToasterToast[]) => void> = [];
const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

let memoryState: ToasterToast[] = [];

function emit() {
  listeners.forEach((listener) => listener(memoryState));
}

function dismiss(toastId?: string) {
  if (toastId) {
    const timeout = toastTimeouts.get(toastId);
    if (timeout) {
      clearTimeout(timeout);
      toastTimeouts.delete(toastId);
    }
    memoryState = memoryState.filter((t) => t.id !== toastId);
  } else {
    toastTimeouts.forEach((timeout) => clearTimeout(timeout));
    toastTimeouts.clear();
    memoryState = [];
  }
  emit();
}

export function toast(props: Toast) {
  const id = nextId();

  const update = (next: ToasterToast) => {
    memoryState = memoryState.map((t) => (t.id === next.id ? { ...t, ...next } : t));
    emit();
  };

  const dismissThis = () => dismiss(id);

  memoryState = [...memoryState, { ...props, id, open: true, onOpenChange: (open) => !open && dismissThis() }];

  // Auto-dismiss after a delay, matching the shadcn recipe.
  toastTimeouts.set(
    id,
    setTimeout(() => {
      toastTimeouts.delete(id);
      dismiss(id);
    }, TOAST_REMOVE_DELAY),
  );

  emit();

  return { id, dismiss: dismissThis, update };
}

export function useToast() {
  const [toasts, setToasts] = React.useState<ToasterToast[]>(memoryState);

  React.useEffect(() => {
    listeners.push(setToasts);
    return () => {
      const index = listeners.indexOf(setToasts);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  return { toasts, toast, dismiss };
}