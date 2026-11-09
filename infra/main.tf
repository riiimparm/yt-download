provider "cloudflare" {}

resource "cloudflare_worker" "app" {
  account_id = var.account_id
  name       = var.worker_name
  logpush    = false

  observability = {
    enabled = false
  }

  subdomain = {
    enabled          = true
    previews_enabled = false
  }
}

resource "cloudflare_worker_version" "app" {
  account_id         = var.account_id
  worker_id          = cloudflare_worker.app.id
  compatibility_date = "2026-11-08"
  main_module        = "index.mjs"
  deploy             = true

  assets = {
    directory = "${path.module}/../dist/assets"
    config = {
      not_found_handling = "none"
      run_worker_first   = true
    }
  }

  bindings = [{
    name = "ASSETS"
    type = "assets"
  }]

  modules = [{
    name         = "index.mjs"
    content_file = "${path.module}/../worker/index.mjs"
    content_type = "application/javascript+module"
  }]
}

# Cloudflare creates the DNS record and the certificate for this hostname, so
# there is no separate cloudflare_dns_record here. Empty hostname keeps the
# Worker on workers.dev only.
resource "cloudflare_workers_custom_domain" "app" {
  count = var.hostname == "" ? 0 : 1

  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = var.hostname
  service    = cloudflare_worker.app.name
}

# One rate limiting rule for /proxy, so the relay is not free bandwidth. The
# free plan allows exactly one rule per zone, counting by IP over a fixed 10
# second window. Only traffic through the zone is counted: on workers.dev the
# Worker sits in Cloudflare's own zone, where this rule does not apply.
# ponytail: a request rate is not a byte cap, one request can still stream a
# whole video. Cap relayed bytes in the Worker if that becomes the problem.
resource "cloudflare_ruleset" "relay_rate_limit" {
  count = var.hostname == "" ? 0 : 1

  zone_id = var.zone_id
  name    = "yt-download relay"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules = [{
    action      = "block"
    description = "Limit /proxy to 30 requests per 10 seconds per IP"
    expression  = "http.request.uri.path eq \"/proxy\""

    ratelimit = {
      # cf.colo.id is mandatory in the API. Free and Pro count by IP only.
      characteristics     = ["cf.colo.id", "ip.src"]
      period              = 10
      requests_per_period = 30
      mitigation_timeout  = 10
    }
  }]
}
