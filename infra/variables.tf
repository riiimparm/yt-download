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
