import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react-native';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ToastVariant = 'default' | 'destructive';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      nextId.current += 1;
      setItems((current) => [...current, { ...options, id: nextId.current }]);
    },
    [],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside a ToastProvider.');
  }
  return context;
}

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  // The provider only mounts once, but the theme can flip at runtime.
  const theme = useTheme();

  if (items.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={styles.viewport}>
      {items.map((item) => (
        <ToastRow key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </View>
  );
}

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const theme = useTheme();

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id, onDismiss]);

  const destructive = item.variant === 'destructive';
  const Icon = destructive ? CircleAlert : item.description ? CheckCircle2 : Info;

  return (
    <Pressable
      accessibilityRole="alert"
      onPress={() => onDismiss(item.id)}
      style={[
        styles.row,
        {
          backgroundColor: destructive ? '#450A0A' : theme.text,
          borderColor: destructive ? '#7F1D1D' : theme.text,
        },
      ]}
    >
      <Icon color={destructive ? '#FCA5A5' : theme.background} size={18} style={styles.icon} />
      <View style={styles.body}>
        <Text numberOfLines={2} style={[styles.title, { color: destructive ? '#FEF2F2' : theme.background }]}>
          {item.title}
        </Text>
        {item.description ? (
          <Text
            numberOfLines={3}
            style={[styles.description, { color: destructive ? '#FECACA' : theme.background }]}
          >
            {item.description}
          </Text>
        ) : null}
      </View>
      <X color={destructive ? '#FCA5A5' : theme.background} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  viewport: {
    bottom: Spacing.three,
    gap: Spacing.two,
    maxWidth: 380,
    position: 'absolute',
    right: Spacing.three,
    width: '86%',
    zIndex: 100,
  },
  row: {
    alignItems: 'flex-start',
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.three,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  icon: {
    marginTop: 1,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  description: {
    fontSize: 13,
    lineHeight: 17,
    opacity: 0.85,
  },
});