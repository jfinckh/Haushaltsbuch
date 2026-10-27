# Settings for the infrastructure. The workflow sets them from GitHub variables (TF_VAR_<name>).

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (dashboard, right column of the domain's overview)."
  type        = string
}

variable "domain" {
  description = "Domain whose DNS is at Cloudflare, e.g. example.com."
  type        = string
}

variable "app_subdomain" {
  description = "The app is reachable at <app_subdomain>.<domain>."
  type        = string
  default     = "haushalt"
}

variable "ssh_subdomain" {
  description = "SSH for the deploy job goes through <ssh_subdomain>.<domain> (only with the service token)."
  type        = string
  default     = "ssh-haushalt"
}

variable "allowed_emails" {
  description = "Who may sign in. Cloudflare Access lets nobody else reach the app."
  type        = list(string)

  validation {
    condition     = length(var.allowed_emails) > 0
    error_message = "At least one email is needed, otherwise nobody can sign in."
  }
}

variable "access_session_duration" {
  description = "How long a Cloudflare Access sign-in lasts."
  type        = string
  default     = "730h" # about a month, so the PWA stays signed in
}

variable "server_type" {
  description = "Hetzner server type. cx23 is the cheapest x86 type; cax11 (ARM) also needs an arm64 image."
  type        = string
  default     = "cx23"
}

variable "location" {
  description = "Hetzner location: nbg1 (Nuremberg), fsn1 (Falkenstein) or hel1 (Helsinki)."
  type        = string
  default     = "nbg1"
}

variable "volume_size" {
  description = "Size of the database volume in GB (can grow later, never shrink)."
  type        = number
  default     = 10
}

variable "ssh_public_key" {
  description = "Public key of the deploy SSH key pair (the private key is the GitHub secret SSH_PRIVATE_KEY)."
  type        = string
}

variable "backup_bucket" {
  description = "Name of the R2 bucket for database backups (created by hand, see README)."
  type        = string
}

variable "backup_retention_days" {
  description = "Backups older than this are deleted by R2."
  type        = number
  default     = 30
}
