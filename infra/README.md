# Azure infrastructure

Creates one environment's object storage, the identity `apps/python` uses, and the image registry. Application hosting is not included yet (`AZURE-HOST-001` in `docs/feature_list_azure_storage.json`).

## First deploy

These commands create billed resources.

```bash
brew install azure-cli
az login
az group create --name rg-softsensor-dev --location <region>

export STORAGE_ACCOUNT_NAME=<globally unique, lowercase>
export ACR_NAME=<globally unique, alphanumeric>
export STORAGE_ALLOWED_IPS=<your public IP>
export DEVELOPER_PRINCIPAL_ID=$(az ad signed-in-user show --query id -o tsv)

az deployment group what-if --resource-group rg-softsensor-dev --parameters infra/env/dev.bicepparam
az deployment group create  --resource-group rg-softsensor-dev --parameters infra/env/dev.bicepparam
```

## Run the app against it

Add to `.env`, then restart the Python service:

```
STORAGE_BACKEND=azure
AZURE_STORAGE_ACCOUNT_URL=https://<account>.blob.core.windows.net
AZURE_STORAGE_CONTAINER=datasets
TRAINING_IMAGE=scgc/soft-sensor-trainer:1.0.28
```

Sign-in comes from `az login` locally and from the managed identity in Azure. Role assignments can take a few minutes to apply after the first deploy.

Datasets already stored in MinIO are not visible while `STORAGE_BACKEND=azure`. Azure starts empty by design.

## Azure DevOps setup

`azure-pipelines.yml` runs CI, deploys this template, and builds images.

1. Create a resource group for the environment.
2. Create an Azure Resource Manager service connection using **workload identity federation**, named `sc-softsensor-dev`. Give its identity on the resource group:
   - `Contributor`
   - `Role Based Access Control Administrator`, because the template assigns roles
   - `AcrPush`, after the first deploy has created the registry
3. Create a variable group `softsensor-dev` with `RESOURCE_GROUP`, `STORAGE_ACCOUNT_NAME`, `ACR_NAME` and `STORAGE_ALLOWED_IPS`.
4. Create an environment `softsensor-dev`. Add approvals on the service connection.
5. Create the pipeline from `azure-pipelines.yml`.
