// Vendored by HelloHowAreYouHaveANiceDay/standards (profile analytics-web); do not edit -- re-run sync.
export interface AnalyticsPlan {
  schema: 'analytics-plan/1';
  tier: 1 | 2;
  visit_id?: boolean;
  wrappers?: string[];
  property: { domain: string; hosts: string[]; ga4: string; posthog: null | { project: string | number; decision: string }; url_params?: string[] };
  events: Record<string, { stage: 'landing' | 'engage' | 'activate' | 'convert' | 'pay'; key_event?: boolean; sinks?: Array<'ga4' | 'ae' | 'posthog'>; params?: Record<string, { enum?: string[]; dim?: boolean }> }>;
}
export function inConsentRegion(zone?: string): boolean;
export function redactUrl(url: string, allow?: string[]): string;
export function initAnalytics(plan: AnalyticsPlan): boolean;
export function initSnippet(plan: AnalyticsPlan): string;
export function track(name: string, params?: Record<string, string | number | boolean>): void;
export function visitId(): string | null;
