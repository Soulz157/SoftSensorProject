using '../main.bicep'

param environmentName = 'dev'
param storageAccountName = readEnvironmentVariable('STORAGE_ACCOUNT_NAME')
param registryName = readEnvironmentVariable('ACR_NAME')
param storageSku = 'Standard_LRS'

// Public with an allowlist because the dev test runs the app on a laptop.
param publicNetworkAccess = 'Enabled'
param allowedIpRanges = split(readEnvironmentVariable('STORAGE_ALLOWED_IPS', ''), ',')
param developerPrincipalId = readEnvironmentVariable('DEVELOPER_PRINCIPAL_ID', '')
