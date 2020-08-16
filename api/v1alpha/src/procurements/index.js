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

const express = require('express');
const dataManager = require("./dataManager");

/************************************************************
  API Endpoints
 ************************************************************/
// Define the routes for the REST API
var procurements = express.Router();
// methods that require multiple routes

/**
 * @swagger
 *
 *
 * definitions:
 *   Policy:
 *     type: object
 *     description: Procurement object
 *     properties:
 *       rowId:
 *         type: string
 *         readOnly: true
 *         description: Procurement Row ID
 *       eventId:
 *         type: string
 *         readOnly: true
 *         description: Marketplace Pub/Sub message eventId
 *       eventType:
 *         type: string
 *         description: Marketplace Pub/Sub message eventType
 *       acknowledged:
 *         type: boolean
 *         description: Indicates if the event was acknowledged.
 *       createdAt:
 *         type: string
 *         description: Record creation time
 *       accountId:
 *         type: string
 *         description: Billing accountId of the consumer
 *       entitlementId:
 *         type: string
 *         description: Entitlement Id of the purchased SKU
 *     required:
 *       - rowId
 *       - eventId
 *       - eventType
 */

/**
 * @swagger
 *
 * /projects/{projectId}/procurements:
 *   get:
 *     summary: List Procurements based off request parameters
 *     description: Returns the ProcurementList response
 *     tags:
 *       - procurements
 *     parameters:
 *     - in: path
 *       name: projectId
 *       schema:
 *          type: string
 *       required: true
 *       description: Project Id of the Procurement request
 *     responses:
 *       200:
 *         description: Procurement list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: Success of the request
 *                 code:
 *                   type: integer
 *                   default: 200
 *                   description: HTTP status code
 *                 data:
 *                   type: array
 *                   items:
 *                      $ref: '#/definitions/Procurement'
 *       500:
 *         description: Error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/definitions/Error'
 */
procurements.get('/projects/:projectId/procurements', async (req, res) => {
    const projectId = req.params.projectId;
    let stateFilter = null;
    if (req.query.stateFilter) {
        stateFilter = req.query.stateFilter.split(',');
    }
    const data = await dataManager.listProcurements(projectId, stateFilter);
    var code;
    if (data && data.success === false) {
        code = (data.code === undefined) ? 500 : data.code;
    } else {
        code = (data.code === undefined) ? 200 : data.code;
    }
    res.status(code).json({
        code: code,
        ...data
    });
});

procurements.post('/projects/:projectId/procurements/approve', async (req, res) => {
    const projectId = req.params.projectId;
    const name = req.body.name;
    const status = req.body.status;
    const reason = req.body.reason;
    const accountId = req.body.accountId;
    const policyId = req.body.policyId;
    const data = await dataManager.approveEntitlement(projectId, name, status, reason, accountId, policyId);
    var code;
    if (data && data.success === false) {
        code = (data.code === undefined) ? 500 : data.code;
    } else {
        code = (data.code === undefined) ? 200 : data.code;
    }
    res.status(code).json({
        code: code,
        ...data
    });
});

module.exports = procurements;