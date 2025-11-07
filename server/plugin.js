/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { first } from 'rxjs/operators';
import { createAlertingCluster, createAlertingADCluster } from './clusters';
import {
  AlertService,
  DestinationsService,
  OpensearchService,
  MonitorService,
  PplAlertingMonitorService,
  AnomalyDetectorService,
  FindingService,
  CrossClusterService,
  CommentsService,
} from './services';
import { FEATURE_FLAGS, PLUGIN_ID } from './services/utils/constants';
import {
  alerts,
  destinations,
  opensearch,
  monitors,
  pplAlertingMonitors,
  detectors,
  findings,
  crossCluster,
  comments,
} from '../server/routes';
import { JSON_SCHEMA } from 'js-yaml';

export class AlertingPlugin {
  constructor(initializerContext) {
    this.logger = initializerContext.logger.get();
    this.globalConfig$ = initializerContext.config.legacy.globalConfig$;
    this.pluginConfig$ = initializerContext.config.create();
    this.core = null;
    this.dynamicConfig = undefined;
  }

  async getDynamicConfig(request) {
    if (this.dynamicConfig === undefined) {
      const { dynamicConfigService } = this.core;
      this.dynamicConfig = await dynamicConfigService.getStartService();
    }

    const client = this.dynamicConfig.getClient();
    const dynamicConfigContextStore = this.dynamicConfig.createStoreFromRequest(request);
    return await client.getConfig(
      { pluginConfigPath: PLUGIN_ID },
      { asyncLocalStorageContext: dynamicConfigContextStore }
    );
  }

  async getConfigWithoutRequest() {
    if (this.dynamicConfig === undefined) {
      const { dynamicConfigService } = this.core;
      this.dynamicConfig = await dynamicConfigService.getStartService();
    }

    const client = this.dynamicConfig.getClient();
    return await client.getConfig({ pluginConfigPath: PLUGIN_ID });
  }

  async setup(core, { dataSource }) {
    this.core = core;
    // Get the global configuration settings of the cluster
    const globalConfig = await this.globalConfig$.pipe(first()).toPromise();
    const pluginConfig = await this.pluginConfig$.pipe(first()).toPromise();

    const dataSourceEnabled = !!dataSource;

    // Create clusters
    const alertingESClient = createAlertingCluster(
      core,
      globalConfig,
      dataSourceEnabled,
      dataSource
    );
    const adESClient = createAlertingADCluster(core, globalConfig, dataSourceEnabled, dataSource);

    // Initialize services
    const alertService = new AlertService(alertingESClient, dataSourceEnabled);
    const opensearchService = new OpensearchService(alertingESClient, dataSourceEnabled);
    const monitorService = new MonitorService(alertingESClient, dataSourceEnabled);
    const pplMonitorService = new PplAlertingMonitorService(
      alertingESClient,
      dataSourceEnabled,
      this.logger
    );
    const destinationsService = new DestinationsService(alertingESClient, dataSourceEnabled);
    const anomalyDetectorService = new AnomalyDetectorService(adESClient, dataSourceEnabled);
    const findingService = new FindingService(alertingESClient, dataSourceEnabled);
    const crossClusterService = new CrossClusterService(alertingESClient, dataSourceEnabled);
    const commentsService = new CommentsService(alertingESClient, dataSourceEnabled);
    const services = {
      alertService,
      destinationsService,
      opensearchService,
      monitorService,
      pplMonitorService,
      anomalyDetectorService,
      findingService,
      crossClusterService,
      commentsService,
    };

    const defaultPplEnabled = Boolean(pluginConfig?.pplAlertingEnabled);

    core.capabilities.registerProvider(() => ({
      alertingDashboards: {
        pplV2: defaultPplEnabled,
      },
    }));

    core.capabilities.registerSwitcher(async (request) => {
      try {
        const config = await this.getDynamicConfig(request);
        const pplEnabled = config?.[FEATURE_FLAGS.PPL_MONITOR];
        return {
          alertingDashboards: {
            pplV2: pplEnabled,
          },
        };
      } catch (err) {
        this.logger?.debug?.(
          `[Alerting][Plugin] Failed to resolve dynamic PPL flag: ${err?.message ?? err}`
        );
        return {
          alertingDashboards: {
            pplV2: defaultPplEnabled,
          },
        };
      }
    });

    // Create router
    const router = core.http.createRouter();
    let pplRoutesEnabled = defaultPplEnabled;
    try {
      const initialDynamicConfig = await this.getConfigWithoutRequest();
      pplRoutesEnabled = initialDynamicConfig?.[FEATURE_FLAGS.PPL_MONITOR];
    } catch (err) {
      this.logger?.debug?.(
        `[Alerting][Plugin] Failed to resolve initial dynamic PPL flag: ${err?.message ?? err}`
      );
    }

    // Add server routes
    alerts(services, router, dataSourceEnabled);
    destinations(services, router, dataSourceEnabled);
    opensearch(services, router, dataSourceEnabled);
    monitors(services, router, dataSourceEnabled);
    if (pplRoutesEnabled) {
      pplAlertingMonitors(services, router, dataSourceEnabled);
    }
    detectors(services, router, dataSourceEnabled);
    findings(services, router, dataSourceEnabled);
    crossCluster(services, router, dataSourceEnabled);
    comments(services, router, dataSourceEnabled);

    return {};
  }

  async start(core) {
    return {};
  }
}
