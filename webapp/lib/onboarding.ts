interface OnboardingSnapshot {
  settings: { githubConnected: boolean };
  hosts: Array<{ enabled: boolean; transports?: string[] }>;
}

export function onboardingState(snapshot: OnboardingSnapshot) {
  const githubConnected = snapshot.settings.githubConnected;
  const paseoConfigured = snapshot.hosts.some((host) => host.enabled && Boolean(host.transports?.length));
  return { githubConnected, paseoConfigured, complete: githubConnected && paseoConfigured };
}
