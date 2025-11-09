/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import _ from 'lodash';
import { EuiSpacer, EuiText, EuiRadioGroup } from '@elastic/eui';
import { Field } from 'formik';
import { PplAlertingVisualGraph } from '../../CreateMonitor/components/VisualGraph/PplAlertingVisualGraph';
import TriggerExpressionsPpl from './TriggerExpressions/TriggerExpressionsPpl';

const TriggerGraphPpl = ({
  monitorValues,
  response,
  thresholdValue,
  thresholdEnum,
  fieldPath,
  flyoutMode,
  hideThresholdControls = false,
  showModeSelector = false,
}) => {
  const hasSetInitialThreshold = useRef(false);
  const [graphKey, setGraphKey] = useState(0);
  const [formikHelperRef, setFormikHelperRef] = useState(null);

  useEffect(() => {
    setGraphKey((prev) => prev + 1);
  }, [thresholdValue]);

  const handleMaxYValueCalculated = useCallback(
    (maxY) => {
      if (
        !hasSetInitialThreshold.current &&
        thresholdValue === 10000 &&
        maxY > 0 &&
        formikHelperRef
      ) {
        formikHelperRef.setValue(maxY);
        hasSetInitialThreshold.current = true;
      }
    },
    [thresholdValue, formikHelperRef]
  );

  let buckets =
    _.get(response, 'aggregations.date_histogram.buckets') ||
    _.get(response, 'aggregations.counts.buckets') ||
    _.get(response, 'aggregations.count_over_time.buckets') ||
    _.get(response, 'aggregations.combined_value.buckets') ||
    _.get(response, 'aggregations.ppl_histogram.buckets') ||
    [];

  const total =
    _.get(response, 'hits.total.value') ??
    (_.get(response, 'total') !== undefined ? _.get(response, 'total') : undefined);

  const shouldSynthesizeBuckets = !response || !response.aggregations;
  if ((!buckets || buckets.length === 0) && shouldSynthesizeBuckets) {
    const now = Date.now();
    buckets = [{ key: now, doc_count: 0 }];
  }

  const graphResponse = {
    hits: total != null ? { total: { value: Number(total) || 0, relation: 'eq' } } : undefined,
    aggregations: {
      count_over_time: { buckets },
      combined_value: { buckets },
      date_histogram: { buckets },
      ppl_histogram: { buckets },
    },
  };

  return (
    <div style={flyoutMode ? {} : { padding: '0px 10px' }}>
      <Field name={`${fieldPath}thresholdValue`}>
        {({ field, form }) => {
          useEffect(() => {
            if (!formikHelperRef) {
              setFormikHelperRef({
                setValue: (val) => form.setFieldValue(field.name, val, false),
              });
            }
          }, [form, field.name]);
          return null;
        }}
      </Field>

      {!hideThresholdControls && (
        <TriggerExpressionsPpl
          thresholdValue={thresholdValue}
          thresholdEnum={thresholdEnum}
          keyFieldName={`${fieldPath}thresholdEnum`}
          valueFieldName={`${fieldPath}thresholdValue`}
          label="Trigger condition"
          flyoutMode={flyoutMode}
        />
      )}

      {showModeSelector && (
        <>
          <EuiSpacer size="s" />
          <EuiText size="xs">
            <strong>Trigger</strong>
          </EuiText>
          <Field name={`${fieldPath}mode`}>
            {({ field, form }) => (
              <EuiRadioGroup
                options={[
                  { id: 'result_set', label: 'Once' },
                  { id: 'per_result', label: 'For each result' },
                ]}
                idSelected={field.value === 'per_result' ? 'per_result' : 'result_set'}
                onChange={(id) => form.setFieldValue(`${fieldPath}mode`, id)}
                data-test-subj="triggerMode"
              />
            )}
          </Field>
        </>
      )}

      {!flyoutMode && (
        <>
          {!hideThresholdControls && <EuiSpacer size="m" />}
          <PplAlertingVisualGraph
            key={graphKey}
            values={monitorValues}
            thresholdValue={thresholdValue}
            response={graphResponse}
            services={{}}
            onMaxYValueCalculated={handleMaxYValueCalculated}
          />
        </>
      )}
    </div>
  );
};

TriggerGraphPpl.propTypes = {
  monitorValues: PropTypes.object,
  response: PropTypes.any,
  thresholdValue: PropTypes.any,
  thresholdEnum: PropTypes.any,
  fieldPath: PropTypes.string,
  flyoutMode: PropTypes.bool,
  hideThresholdControls: PropTypes.bool,
  showModeSelector: PropTypes.bool,
};

export default TriggerGraphPpl;
