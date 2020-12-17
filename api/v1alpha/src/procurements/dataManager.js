/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const { BigQueryUtil, CommerceProcurementUtil } = require('cds-shared');
const cfg = require('../lib/config');
const underscore = require("underscore");
const accountManager = require('../accounts/dataManager');
const policyManager = require('../policies/dataManager');

/**
 * @param  {string} projectId
 * @param  {string} datasetId
 * @param  {string} tableId
 * Get the FQDN format for a project's table or view name
 */
function getTableFqdn(projectId, datasetId, tableId) {
    return `${projectId}.${datasetId}.${tableId}`;
}

/**
 * @param  {string} projectId
 * @param  {} stateFilter
 * Get a list of Procurements
 */
async function listProcurements(projectId, stateFilter) {
    try {
        const procurementUtil = new CommerceProcurementUtil(projectId);
        const bigqueryUtil = new BigQueryUtil(projectId);

        let filter = 'state=';
        if (stateFilter && stateFilter.length > 0) {
            filter += stateFilter.join(' OR state=')
        } else {
            filter += 'ENTITLEMENT_ACTIVATION_REQUESTED';
        }

        const result = await procurementUtil.listEntitlements(filter);
        let entitlements = result.entitlements || [];

        const accountNames = underscore.uniq(entitlements.map(e => e.account));

        // Query for the policy data and join that on for policy name.
        const products = entitlements.map(e => e.product + '$||$' + e.plan);

        if (products && products.length > 0) {
            const table = getTableFqdn(projectId, cfg.cdsDatasetId, cfg.cdsPolicyViewId);
            const query = `WITH policyData AS (
    SELECT
        policyId,
        marketplace,
        CONCAT(marketplace.solutionId, '$||$', marketplace.planId) AS marketplaceId,
        name,
        description
    FROM \`${table}\`
    WHERE marketplace IS NOT NULL
)
SELECT *
FROM policyData
WHERE marketplaceId IN UNNEST(@products)`;

            const options = {
                query: query,
                params: { products: products },
            }
            const [policyRows] = await bigqueryUtil.executeQuery(options);
            if (policyRows && policyRows.length > 0) {
                entitlements.forEach(e => {
                    const policy = underscore.findWhere(policyRows, { marketplaceId: e.product + '$||$' + e.plan });
                    if (policy) {
                        e.policy = { policyId: policy.policyId, name: policy.name, description: policy.description };
                    }
                });
            }
        }

        // Set activated flag to false
        entitlements.forEach(e => {
            e.activated = false;
        });

        if (accountNames && accountNames.length > 0) {
            const table = getTableFqdn(projectId, cfg.cdsDatasetId, cfg.cdsAccountViewId);
            const query = `SELECT a.accountId, m.accountName, a.email
FROM \`${table}\` a
CROSS JOIN UNNEST(a.marketplace) AS m
WHERE m.accountName IN UNNEST(@accountNames)`;

            const options = {
                query: query,
                params: { accountNames: accountNames },
            }
            const [accountRows] = await bigqueryUtil.executeQuery(options);

            if (accountRows && accountRows.length > 0) {
                entitlements.forEach(e => {
                    const account = underscore.findWhere(accountRows, { accountName: e.account });
                    if (account) {
                        e.email = account.email;
                        e.accountId = account.accountId;
                        if (e.policy) {
                            // Only set activated if a policy is found.
                            e.activated = true;
                        }
                    }
                });
            }
        }

        return { success: true, data: entitlements };
    } catch (err) {
        console.error(err);
        return { success: false, errors: ['Failed to retrieve pending entitlement list', err] };
    }
}

/**
 * @param  {} projectId The projectId for the provider
 * @param  {} name Name of the entitlement resource
 * @param  {} status The approval status, should be one of ['approve', 'reject', 'comment']
 * @param  {} reason Only provided for a rejection
 * @param  {} accountId The datashare accountId
 * @param  {} policyId The datashare policyId
 * @param  {} state The current state of the entitlement
 */
async function approveEntitlement(projectId, name, status, reason, accountId, policyId, state) {
    try {
        const procurementUtil = new CommerceProcurementUtil(projectId);
        if (state === 'ENTITLEMENT_ACTIVATION_REQUESTED') {
            if (status === 'approve') {
                const result = await procurementUtil.approveEntitlement(name);
                const account = await accountManager.getAccount(projectId, accountId);
                const policyRecord = { policyId: policyId };
                let accountData = account.data;
                let policies = accountData.policies || [];
                const found = underscore.findWhere(policies, policyRecord);
                if (!found) {
                    policies.push(policyRecord);
                    // TODO: Get rid of this conversion
                    accountData.policies = accountData.policies.map(e => e.policyId);
                    accountData.createdBy = accountData.email;
                    await accountManager.createOrUpdateAccount(projectId, accountId, accountData);
                }
                return { success: true, data: result };
            } else if (status === 'reject') {
                const result = await procurementUtil.rejectEntitlement(name, reason);
                return { success: true, data: result };
            } else if (status === 'comment') {
                const result = await procurementUtil.updateEntitlementMessage(name, reason);
                return { success: true, data: result };
            }
        } else if (state === 'ENTITLEMENT_PENDING_PLAN_CHANGE_APPROVAL') {
            // Handle approval and rejection for plan change approval
            // Do an entitlement get to find the current plan name and the new pending name
            // Parameter for getting the entitlement is the name: name.
            const entitlement = await procurementUtil.getEntitlement(name);
            // const currentPlan = entitlement.currentPlan;
            const newPendingPlan = entitlement.newPendingPlan;
            if (status === 'approve') {
                // Approve plan change, this would only be for a manual approve.
                // An automated approval would be handled by a Pub/Sub notification.
                // Remove user from current policy and add to new plan related policy.
                // Re-factor removeEntitlement so that it doesn't call createOrUpdateAccount maybe, in order that we can remove and add using the same functions.
                // const result = await procurementUtil.approvePlanChange(name, newPendingPlan);
                const result = {};
                return { success: true, data: result };
            } else if (status === 'reject') {
                // No need to do anything further, existing plan and policy relations will remain the same.
                const result = await procurementUtil.rejectPlanChange(name, newPendingPlan, reason);
                return { success: true, data: result };
            }
        }
    } catch (err) {
        console.error(err);
        return { success: false, errors: ['Failed to approve entitlement', err] };
    }
}

/**
 * @param  {} projectId
 * @param  {} accountId
 * @param  {} policyId
 */
async function removeEntitlement(projectId, accountId, policyId) {
    const account = await accountManager.getAccount(projectId, accountId);
    const policyRecord = { policyId: policyId };
    let accountData = account.data;
    let policies = accountData.policies || [];
    const found = underscore.findWhere(policies, policyRecord);
    if (found) {
        // Remove the matched policyId.
        policies = underscore.without(policies, underscore.findWhere(policies, policyRecord));
        const filtered = policies.filter(function (el) {
            return el != null && el.policyId.trim() !== '';
        });
        // TODO: Get rid of this conversion
        accountData.policies = filtered.map(e => e.policyId);
        accountData.createdBy = accountData.email;
        await accountManager.createOrUpdateAccount(projectId, accountId, accountData);
    } else {
        console.error(`Policy not found: '${policyId}', account '${accountId}' will not be updated.`);
    }
}

/**
 * @param  {} projectId
 * @param  {} entitlementId
 */
async function autoApproveEntitlement(projectId, entitlementId) {
    const procurementUtil = new CommerceProcurementUtil(projectId);

    // Get the fully qualified entitlement resource name
    const entitlementName = procurementUtil.getEntitlementName(projectId, entitlementId);

    // Get the entitlement object from the procurement api
    const entitlement = await procurementUtil.getEntitlement(entitlementName);
    console.log(`Entitlement: ${JSON.stringify(entitlement, null, 3)}`);
    const product = entitlement.product;
    const plan = entitlement.plan;
    const accountName = entitlement.account;

    const policyData = await policyManager.findMarketplacePolicy(projectId, product, plan);
    console.log(`Found policy ${JSON.stringify(policyData, null, 3)}`);
    if (policyData && policyData.success === true && policyData.data.marketplace) {
        const policy = policyData.data;
        const enableAutoApprove = policy.marketplace.enableAutoApprove;
        if (enableAutoApprove === true) {
            console.log(`Auto approve is enabled for policy ${policy.policyId}, will check if the user account is already activated`);
            // We need to associate the user to this entitlement, so user must register and activate.
            if (accountName) {
                // Approve the account (if it's activated in Datashare already)
                // Otherwise, do not approve - return, and only approve upon the account dataManager activation
                // When activating an account, check if there are any pending entitlement activations
                // which are associated to policies that allow enableAutoApprove
                // If so, upon activating the account, associate the policy and approve the entitlement
                const accountData = await accountManager.findMarketplaceAccount(projectId, accountName);
                console.log(`Account data: ${JSON.stringify(accountData, null, 3)}`);
                if (accountData && accountData.success) {
                    console.log(`Account is already activated, will now proceed to approve the entitlement`);
                    const account = accountData.data;

                    // We should not auto approve the entitlement if the account was not activated
                    // as if the account wasn't activated yet, we do not know the email address for the associated user
                    // As a side note, an entitlement cannot be approved unless the associated account is already activated
                    // the account should always be approved first, followed by the entitlement
                    await approveEntitlement(projectId, entitlementName, 'approve', null, account.accountId, policy.policyId);
                } else {
                    console.log(`Account was not found, entitlement will not be auto-approved`);
                }
            }
        } else {
            console.log(`Auto approve is not enabled for policy: ${policy.policyId}`);
        }
    }
}

/**
 * @param  {} projectId
 * @param  {} entitlementId
 */
async function cancelEntitlement(projectId, entitlementId) {
    const procurementUtil = new CommerceProcurementUtil(projectId);

    // Get the fully qualified entitlement resource name
    const entitlementName = procurementUtil.getEntitlementName(projectId, entitlementId);

    // Get the entitlement object from the procurement api
    const entitlement = await procurementUtil.getEntitlement(entitlementName);
    console.log(`Entitlement: ${JSON.stringify(entitlement, null, 3)}`);
    const product = entitlement.product;
    const plan = entitlement.plan;
    const accountName = entitlement.account;

    const policyData = await policyManager.findMarketplacePolicy(projectId, product, plan);
    console.log(`Found policy ${JSON.stringify(policyData, null, 3)}`);
    if (policyData.success === true) {
        const accountData = await accountManager.findMarketplaceAccount(projectId, accountName);
        console.log(`Account data: ${JSON.stringify(accountData, null, 3)}`);
        if (accountData && accountData.success) {
            console.log(`Account found, will now proceed to remove the entitlement`);
            const account = accountData.data;
            await removeEntitlement(projectId, account.accountId, policyData.data.policyId);
        }
    } else {
        console.error(`Policy not found for cancelled entitlementId: ${entitlementId}`);
    }
}

module.exports = {
    listProcurements,
    approveEntitlement,
    autoApproveEntitlement,
    cancelEntitlement
};
