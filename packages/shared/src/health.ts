/** Shape returned by GET /api/health and shown on the web /diagnostics page. */
export type ComponentStatus = 'up' | 'down';

export interface ComponentHealth {
  status: ComponentStatus;
  latencyMs?: number;
  error?: string;
}

export interface SystemHealth {
  status: ComponentStatus;
  checkedAt: string;
  components: {
    api: ComponentHealth;
    postgres: ComponentHealth;
    redis: ComponentHealth;
    worker: ComponentHealth;
  };
}
