# Infrastructure for the production server, applied by .github/workflows/deploy.yml (job "infra").
# OpenTofu (Terraform-compatible). Credentials come from the environment, never from these files:
#   HCLOUD_TOKEN, CLOUDFLARE_API_TOKEN          provider logins
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY    R2 key for the state bucket (S3 API)
#   TF_ENCRYPTION                               encrypts the state client-side (OpenTofu only)
#   TF_VAR_*                                    the variables in variables.tf

terraform {
  required_version = ">= 1.8"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.52"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.8"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # State in a Cloudflare R2 bucket over the S3 API. Bucket and endpoint are passed at init:
  #   tofu init -backend-config="bucket=<bucket>" \
  #             -backend-config="endpoints={s3=\"https://<account id>.r2.cloudflarestorage.com\"}"
  backend "s3" {
    key                         = "haushaltsbuch/terraform.tfstate"
    region                      = "auto"
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

provider "hcloud" {}

provider "cloudflare" {}
