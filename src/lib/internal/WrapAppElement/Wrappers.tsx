import React from 'react';
import type { ReactNode } from 'react';
import { UnirendHeadProvider } from '../UnirendHead';
import type { HeadCollector } from '../UnirendHead';

/**
 * Conditional StrictMode wrapper component
 */
export function ConditionalStrictMode({
  isEnabled,
  children,
}: {
  isEnabled: boolean;
  children: ReactNode;
}) {
  if (isEnabled) {
    return <React.StrictMode>{children}</React.StrictMode>;
  }

  return <>{children}</>;
}

/**
 * UnirendHead wrapper — on server passes the collector, on client passes null
 */
export function UnirendHeadWrapper({
  collector,
  children,
}: {
  collector?: HeadCollector;
  children: ReactNode;
}) {
  return (
    <UnirendHeadProvider collector={collector ?? null}>
      {children}
    </UnirendHeadProvider>
  );
}

/**
 * Custom wrapper component handler
 */
export function CustomWrapper({
  WrapComponent,
  children,
}: {
  WrapComponent?: React.ComponentType<{ children: ReactNode }>;
  children: ReactNode;
}) {
  if (WrapComponent) {
    return <WrapComponent>{children}</WrapComponent>;
  }

  return <>{children}</>;
}
