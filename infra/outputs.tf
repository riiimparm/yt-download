output "worker_name" {
  description = "Name of the Worker Terraform manages."
  value       = cloudflare_worker.app.name
}

output "workers_dev_url" {
  description = "workers.dev URL. Empty until the account has a workers.dev subdomain."
  value       = cloudflare_worker.app.subdomain.url
}

output "custom_domain" {
  description = "Hostname the Worker answers on. Null while hostname is empty."
  value       = one(cloudflare_workers_custom_domain.app[*].hostname)
}
