import { useEffect } from 'react';
import { useApp } from '../services.ts';

/** Granola's quiet notices — meetings arrived, the key refused, Import now failed — shown as the app's toast. */
export function useGranolaNotices(): void {
  const { services, ui } = useApp();
  const { granola } = services;
  useEffect(() => granola?.onNotice((notice) => ui.setState({ notice })), [granola, ui]);
}
