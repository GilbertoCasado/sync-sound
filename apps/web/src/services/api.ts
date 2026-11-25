import type { ProviderType } from '@syncsound/shared';

export interface HealthResponse {
  status: string;
  service: string;
  mode: 'stateless-in-memory' | 'postgres';
  registeredProviders: ProviderType[];
  timestamp: string;
}

export async function fetchApiHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health', {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`API health check failed with status ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
}
