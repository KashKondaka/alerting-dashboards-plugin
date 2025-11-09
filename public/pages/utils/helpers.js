/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { getDataSourceEnabled, getDataSource, getAssistantClient } from '../../services/services';
import _ from 'lodash';
import { ShowAlertComments } from '../../components/Comments/ShowAlertComments';
import {
  COMMENTS_ENABLED_SETTING,
  SUMMARY_AGENT_CONFIG_ID,
  LOG_PATTERN_SUMMARY_AGENT_CONFIG_ID,
} from './constants';

export function dataSourceEnabled() {
  try {
    return !!getDataSourceEnabled?.()?.enabled;
  } catch (err) {
    return false;
  }
}

export function getDataSourceQueryObj() {
  try {
    if (!dataSourceEnabled()) return undefined;
    const dataSource = getDataSource?.();
    const dataSourceId = dataSource?.dataSourceId;
    return dataSourceId ? { query: { dataSourceId } } : undefined;
  } catch (err) {
    return undefined;
  }
}

export function getDataSourceId() {
  try {
    if (!dataSourceEnabled()) return undefined;
    return getDataSource?.()?.dataSourceId;
  } catch (err) {
    return undefined;
  }
}

export function isDataSourceChanged(prevProps, currProps) {
  return (
    dataSourceEnabled() && !_.isEqual(prevProps.landingDataSourceId, currProps.landingDataSourceId)
  );
}

export function getURL(url, dataSourceId) {
  if (!dataSourceEnabled()) return url;
  const id =
    dataSourceId ??
    (() => {
      try {
        return getDataSource?.()?.dataSourceId;
      } catch {
        return undefined;
      }
    })();
  return id ? `${url}&dataSourceId=${id}` : url;
}

export function parseQueryStringAndGetDataSource(queryString) {
  const params = {};
  const queryParams = queryString.substring(1).split('&');
  for (const param of queryParams) {
    const pair = param.split('=');
    params[pair[0]] = pair[1];
  }
  return params.hasOwnProperty('dataSourceId') ? params['dataSourceId'] || '' : undefined;
}

export function constructUrlFromDataSource(url) {
  if (!dataSourceEnabled()) return url;
  try {
    const id = getDataSource?.()?.dataSourceId;
    return id ? `${url}&dataSourceId=${id}` : url;
  } catch {
    return url;
  }
}

export const appendCommentsAction = (columns, httpClient) => {
  const actionsColumn = columns.find(({ name }) => name === 'Actions');
  const showCommentsAction = {
    render: (alert) => <ShowAlertComments alert={alert} httpClient={httpClient} />,
  };

  if (actionsColumn) {
    actionsColumn.actions.push(showCommentsAction);
  } else {
    columns.push({
      name: 'Actions',
      sortable: false,
      actions: [showCommentsAction],
    });
  }

  return columns;
};

export async function getIsAgentConfigured(dataSourceId) {
  const assistantClient = getAssistantClient();
  try {
    const res = await assistantClient.agentConfigExists(
      [SUMMARY_AGENT_CONFIG_ID, LOG_PATTERN_SUMMARY_AGENT_CONFIG_ID],
      { dataSourceId: dataSourceId }
    );
    return res.exists;
  } catch (e) {
    console.error('Error while checking if agent is configured:', e);
    return false;
  }
}

export async function getIsCommentsEnabled(httpClient) {
  let commentsEnabled = await getClusterSetting(httpClient, COMMENTS_ENABLED_SETTING, false);

  if (typeof commentsEnabled === 'string') {
    return JSON.parse(commentsEnabled);
  }

  return commentsEnabled;
}

export async function getClusterSetting(httpClient, setting, defaultValue) {
  let cluserSetting = defaultValue;

  try {
    const dataSourceQuery = getDataSourceQueryObj();
    const response = await httpClient.get('../api/alerting/_settings', dataSourceQuery);
    if (response.ok) {
      const { defaults, transient, persistent } = response.resp;
      cluserSetting = _.get(
        // If present, take the 'transient' setting.
        transient,
        setting,
        // Else take the 'persistent' setting.
        _.get(
          persistent,
          setting,
          // Else take the 'default' setting.
          _.get(defaults, setting, defaultValue)
        )
      );
    }
  } catch (e) {
    console.log('Error while retrieving settings:', e);
  }

  return cluserSetting;
}
