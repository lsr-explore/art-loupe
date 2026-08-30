'use client';

import { Alert } from '@artloupe/fascia/components/ui/alert';
import { Button } from '@artloupe/fascia/components/ui/button';
import { cn } from '@artloupe/fascia/lib/utils';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

type AlertVariant = 'success' | 'error' | 'info';

interface InlineAlertProps {
  variant: AlertVariant;
  message: string;
  className?: string;
  onDismiss?: () => void;
}

const variantConfig: Record<AlertVariant, { icon: typeof Info; className: string }> = {
  success: {
    icon: CircleCheck,
    className:
      'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200',
  },
  error: {
    icon: CircleAlert,
    className: 'border-destructive/30 bg-destructive/5 text-destructive',
  },
  info: {
    icon: Info,
    className:
      'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
  },
};

export const InlineAlert = ({ variant, message, className, onDismiss }: InlineAlertProps) => {
  const tc = useTranslations('common');
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  const config = variantConfig[variant];
  const Icon = config.icon;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <Alert className={cn('flex items-center gap-3', config.className, className)} role="alert">
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-sm">{message}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleDismiss}
        aria-label={tc('dismissAlert')}
        className="shrink-0"
      >
        <X className="size-3" />
      </Button>
    </Alert>
  );
};
