interface OnboardingSnapshot {
  settings: { githubConnected: boolean; paseoIntroductionSeen?: boolean };
  hosts: Array<{ enabled: boolean; transports?: string[] }>;
}

export function onboardingState(snapshot: OnboardingSnapshot) {
  const githubConnected = snapshot.settings.githubConnected;
  const paseoConfigured = snapshot.hosts.some((host) => host.enabled && Boolean(host.transports?.length));
  const paseoIntroductionSeen = paseoConfigured || Boolean(snapshot.settings.paseoIntroductionSeen);
  return { githubConnected, paseoIntroductionSeen, paseoConfigured, complete: githubConnected && paseoConfigured };
}
