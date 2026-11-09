// AZURE-BLOB-001. Object storage and image registry for one environment.
// Application hosting is not here: see AZURE-HOST-001 in
// docs/feature_list_azure_storage.json.

targetScope = 'resourceGroup'

@description('Short environment name, such as dev.')
param environmentName string

param location string = resourceGroup().location

@description('Globally unique, 3-24 lowercase letters and digits.')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Must match what apps/python reads as AZURE_STORAGE_CONTAINER.')
param containerName string = 'datasets'

@allowed(['Standard_LRS', 'Standard_ZRS'])
param storageSku string = 'Standard_ZRS'

@allowed(['Enabled', 'Disabled'])
param publicNetworkAccess string = 'Disabled'

@description('Public IPs allowed through the firewall when public access is on.')
param allowedIpRanges array = []

@description('Globally unique, alphanumeric.')
param registryName string

@description('Entra object id of a developer who may run the app locally against this account. Leave empty outside dev.')
param developerPrincipalId string = ''

resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-softsensor-python-${environmentName}'
  location: location
}

module storage 'modules/storage.bicep' = {
  name: 'storage-${environmentName}'
  params: {
    location: location
    accountName: storageAccountName
    containerName: containerName
    sku: storageSku
    publicNetworkAccess: publicNetworkAccess
    allowedIpRanges: filter(allowedIpRanges, ip => !empty(ip))
    appPrincipalId: appIdentity.properties.principalId
    developerPrincipalId: developerPrincipalId
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry-${environmentName}'
  params: {
    location: location
    registryName: registryName
  }
}

output storageAccountUrl string = storage.outputs.blobEndpoint
output containerName string = containerName
output appIdentityClientId string = appIdentity.properties.clientId
output registryLoginServer string = registry.outputs.loginServer
