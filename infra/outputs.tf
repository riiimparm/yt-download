output "worker_name" {
  description = "Name of the Worker Terraform manages."
  value       = cloudflare_worker.app.name
}

output "workers_dev_url" {
  description = "workers.dev URL. Empty until the account has a workers.dev subdomain."
  value       = cloudflare_worker.app.subdomain.url
}
