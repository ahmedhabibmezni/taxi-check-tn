import { Capacitor } from '@capacitor/core';

export const isIosPlatform = (): boolean => Capacitor.getPlatform() === 'ios';
export const isAndroidPlatform = (): boolean => Capacitor.getPlatform() === 'android';
// Only Android has the existing personal-assertion recovery workflow.
export const canAcknowledgeNativeRecovery = isAndroidPlatform;
