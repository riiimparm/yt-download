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
      run_worker_first   = ["/proxy"]
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
