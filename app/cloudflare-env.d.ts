declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    REMINDER_SECRET?: string;
    SITE_ORIGIN?: string;
  }
}
