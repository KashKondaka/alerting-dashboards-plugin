/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  EuiFlyout,
  EuiFlyoutHeader,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiTitle,
  EuiButton,
  EuiButtonEmpty,
  EuiFlexGroup,
  EuiFlexItem,
  EuiText,
  EuiSpacer,
  EuiCallOut,
} from '@elastic/eui';
import { Formik } from 'formik';
import _ from 'lodash';
import { FORMIK_INITIAL_VALUES } from '../../pages/CreateMonitor/containers/CreateMonitor/utils/constants';
import { formikToMonitor } from '../../pages/CreateMonitor/containers/CreateMonitor/utils/formikToMonitor';
import { getClient } from '../../services';
import { backendErrorNotification } from '../../utils/helpers';
import { MONITOR_TYPE, SEARCH_TYPE } from '../../utils/constants';

// Import type from explore plugin
// Note: This assumes the explore plugin exports this type
type FlyoutComponentProps = {
  closeFlyout: () => void;
  dependencies: {
    query: any; // QueryWithQueryAsString - includes query string, language, and dataset
    resultStatus: any;
    queryInEditor: string; // Already transformed with source clause by explore plugin
  };
  services: any;
};

export const CreateMonitorFlyout: React.FC<FlyoutComponentProps> = ({
  closeFlyout,
  dependencies,
  services,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Build initial values from dependencies
  const initialValues = {
    ..._.cloneDeep(FORMIK_INITIAL_VALUES),
    // Pre-fill PPL query from editor (already has source clause added by explore plugin)
    pplQuery: dependencies.queryInEditor || '',
    monitor_mode: 'ppl',
    searchType: SEARCH_TYPE.QUERY,
    monitor_type: MONITOR_TYPE.QUERY_LEVEL,
    // Pre-fill data source if available
    dataSourceId: dependencies.query.dataset?.dataSource?.id || '',
    // Set a default name
    name: `Monitor from Explore ${new Date().toISOString().slice(0, 19)}`,
    // Set default index from dataset
    index: dependencies.query.dataset?.title
      ? [{ label: dependencies.query.dataset.title }]
      : [],
  };

  const handleSubmit = async (values: any) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Convert formik values to monitor format
      const monitor = formikToMonitor(values);

      // Create the monitor
      const httpClient = getClient();
      const response = await httpClient.post('../api/alerting/monitors', {
        body: JSON.stringify(monitor),
      });

      if (response.ok) {
        services.notifications.toasts.addSuccess({
          title: 'Monitor created successfully',
          text: `Monitor "${values.name}" has been created.`,
        });
        closeFlyout();
      } else {
        throw new Error(response.error || 'Failed to create monitor');
      }
    } catch (error) {
      console.error('Error creating monitor:', error);
      setSubmitError(error.message || 'An error occurred while creating the monitor');

      // Show error notification
      backendErrorNotification(services.notifications, 'create', 'monitor', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const validateForm = (values: any) => {
    const errors: any = {};

    if (!values.name || values.name.trim() === '') {
      errors.name = 'Monitor name is required';
    }

    if (!values.pplQuery || values.pplQuery.trim() === '') {
      errors.pplQuery = 'PPL query is required';
    }

    return errors;
  };

  return (
    <EuiFlyout onClose={closeFlyout} size="l" ownFocus maxWidth={800}>
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="m">
          <h2>Create Monitor from Query</h2>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiText size="s" color="subdued">
          <p>
            Create a monitor based on your current PPL query in Explore. The query will be
            monitored according to the schedule you define.
          </p>
        </EuiText>
      </EuiFlyoutHeader>

      <Formik
        initialValues={initialValues}
        validate={validateForm}
        onSubmit={handleSubmit}
        validateOnChange={true}
      >
        {({ values, errors, touched, handleChange, handleBlur, handleSubmit, isValid }) => (
          <>
            <EuiFlyoutBody>
              {submitError && (
                <>
                  <EuiCallOut title="Error creating monitor" color="danger" iconType="alert">
                    <p>{submitError}</p>
                  </EuiCallOut>
                  <EuiSpacer />
                </>
              )}

              {/* Monitor Name */}
              <EuiText>
                <h3>Monitor Details</h3>
              </EuiText>
              <EuiSpacer size="s" />

              <div className="euiFormRow">
                <label className="euiFormLabel" htmlFor="monitorName">
                  Monitor name *
                </label>
                <input
                  id="monitorName"
                  name="name"
                  className="euiFieldText"
                  value={values.name}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="Enter monitor name"
                />
                {errors.name && touched.name && (
                  <div className="euiFormErrorText">{errors.name}</div>
                )}
              </div>

              <EuiSpacer />

              {/* PPL Query */}
              <EuiText>
                <h3>Query</h3>
              </EuiText>
              <EuiSpacer size="s" />

              <EuiCallOut title="Query from Explore" iconType="search" color="primary" size="s">
                <p>The following PPL query will be monitored:</p>
              </EuiCallOut>

              <EuiSpacer size="s" />

              <div className="euiFormRow">
                <textarea
                  name="pplQuery"
                  className="euiTextArea"
                  rows={6}
                  value={values.pplQuery}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="Enter PPL query"
                  style={{ fontFamily: 'monospace', fontSize: '12px' }}
                />
                {errors.pplQuery && touched.pplQuery && (
                  <div className="euiFormErrorText">{errors.pplQuery}</div>
                )}
              </div>

              <EuiSpacer />

              {/* Dataset Info */}
              {dependencies.query.dataset && (
                <>
                  <EuiText>
                    <h3>Dataset</h3>
                  </EuiText>
                  <EuiSpacer size="s" />
                  <EuiText size="s">
                    <p>
                      <strong>Index:</strong> {dependencies.query.dataset.title}
                    </p>
                    {dependencies.query.dataset.signalType && (
                      <p>
                        <strong>Type:</strong> {dependencies.query.dataset.signalType}
                      </p>
                    )}
                  </EuiText>
                  <EuiSpacer />
                </>
              )}

              {/* Schedule */}
              <EuiText>
                <h3>Schedule</h3>
              </EuiText>
              <EuiSpacer size="s" />

              <div className="euiFormRow">
                <label className="euiFormLabel">Run every</label>
                <EuiFlexGroup gutterSize="s" alignItems="center">
                  <EuiFlexItem grow={false} style={{ width: '100px' }}>
                    <input
                      type="number"
                      name="period.interval"
                      className="euiFieldNumber"
                      value={values.period.interval}
                      onChange={handleChange}
                      min={1}
                    />
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <select
                      name="period.unit"
                      className="euiSelect"
                      value={values.period.unit}
                      onChange={handleChange}
                    >
                      <option value="MINUTES">Minutes</option>
                      <option value="HOURS">Hours</option>
                      <option value="DAYS">Days</option>
                    </select>
                  </EuiFlexItem>
                </EuiFlexGroup>
              </div>

              <EuiSpacer />

              <EuiCallOut title="Note" iconType="iInCircle" color="warning" size="s">
                <p>
                  This is a simplified monitor creation flow. For advanced settings like triggers,
                  actions, and detailed scheduling, navigate to the full Create Monitor page from
                  the Alerting menu.
                </p>
              </EuiCallOut>
            </EuiFlyoutBody>

            <EuiFlyoutFooter>
              <EuiFlexGroup justifyContent="spaceBetween">
                <EuiFlexItem grow={false}>
                  <EuiButtonEmpty onClick={closeFlyout} flush="left">
                    Cancel
                  </EuiButtonEmpty>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiButton
                    onClick={() => handleSubmit()}
                    fill
                    isLoading={isSubmitting}
                    disabled={!isValid || isSubmitting}
                  >
                    Create Monitor
                  </EuiButton>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiFlyoutFooter>
          </>
        )}
      </Formik>
    </EuiFlyout>
  );
};
