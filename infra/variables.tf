variable "account_id" {
  type        = string
  description = "Cloudflare account ID. Set TF_VAR_account_id. Do not commit terraform.tfvars."
  nullable    = false
}

variable "worker_name" {
  type        = string
  description = "Worker script name. wrangler.toml uses the same default."
  default     = "yt-download"
  nullable    = false

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.worker_name))
    error_message = "worker_name must be a DNS label of up to 63 characters."
  }
}

variable "hostname" {
  type        = string
  description = "Custom domain for the Worker, such as yt-download.example.com. Empty leaves the Worker on workers.dev only."
  default     = ""
  nullable    = false

  validation {
    condition     = var.hostname == "" || can(regex("^[a-z0-9][a-z0-9.-]*\\.[a-z]{2,}$", var.hostname))
    error_message = "hostname must be a bare domain name, with no scheme and no path."
  }
}

variable "zone_id" {
  type        = string
  description = "Cloudflare zone that holds hostname. Required once hostname is set."
  default     = ""
  nullable    = false

  validation {
    condition     = var.hostname == "" || can(regex("^[0-9a-f]{32}$", var.zone_id))
    error_message = "zone_id must be the 32 hexadecimal character zone ID when hostname is set."
  }
}
