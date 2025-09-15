/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import {
  EuiAccordion,
  EuiBadge,
  EuiFlexGroup,
  EuiHorizontalRule,
  EuiInMemoryTable,
  EuiPanel,
  EuiSpacer,
  EuiTabbedContent,
  EuiText,
  EuiCodeBlock,
} from '@elastic/eui';

/** ------------------ helpers: flatten & mapping ------------------ */

const isPlainObject = (v) => Object.prototype.toString.call(v) === '[object Object]';

const flattenObject = (obj, prefix = '', out = {}) => {
  if (obj == null) return out;
  Object.keys(obj).forEach((k) => {
    const key = prefix ? `${prefix}.${k}` : k;
    const val = obj[k];
    if (isPlainObject(val)) {
      flattenObject(val, key, out);
    } else if (Array.isArray(val)) {
      // keep arrays readable; Discover shows them stringified in chips
      out[key] = JSON.stringify(val);
    } else {
      out[key] = val;
    }
  });
  return out;
};

const rowFromSchema = (schema, arrayRow) => {
  const obj = {};
  schema.forEach((col, idx) => {
    obj[col.name] = arrayRow[idx];
  });
  return obj;
};

/**
 * Convert PPL preview response into an array of "documents"
 * that look like Discover’s _source chips (flat key/value map).
 */
export const pplRespToDocs = (resp) => {
  // PPL shape: { schema: [{name, type}...], datarows: [ [...], ...] }
  if (resp && Array.isArray(resp.schema) && Array.isArray(resp.datarows)) {
    return resp.datarows.map((row) => flattenObject(rowFromSchema(resp.schema, row)));
  }

  // ES hits fallback: { hits: { hits: [ {_source, _id, ...}, ... ] } }
  const hits = resp && resp.hits && resp.hits.hits;
  if (Array.isArray(hits)) {
    return hits.map((h) => {
      const meta = {
        _id: h._id,
        _index: h._index,
        _score: h._score,
        _type: h._type,
      };
      const src = isPlainObject(h._source) ? flattenObject(h._source) : {};
      return { ...meta, ...src };
    });
  }

  return [];
};

/** ------------------ shared styles ------------------ */

const chipStyle = {
  backgroundColor: 'rgba(8, 108, 106, .1)',
  border: '1px solid rgba(8, 108, 106, .25)',
  borderRadius: 6,
  padding: '2px 8px',
  fontWeight: 400, // no bold
};

/** ------------------ collapsed token stream (Discover-like) ------------------ */

  const TokenStream = ({ doc }) => {
    const entries = useMemo(() => Object.entries(doc || {}), [doc]);

    // shared sizes so chips & values line up cleanly across wraps
    const CHIP_LINE_HEIGHT = 20; // px
    const CHIP_PAD_Y = 2;        // px

    return (
      <EuiText
        size="s"
        style={{
          // let the stream wrap naturally like a paragraph
          whiteSpace: 'normal',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          lineHeight: `${(CHIP_LINE_HEIGHT + CHIP_PAD_Y * 2) / 14}`, // roughly 1.6 for default 14px
        }}
      >
        {entries.map(([k, v]) => {
          const value =
            typeof v === 'number' ? v.toLocaleString() : String(v ?? '-');

          return (
            <span key={k} style={{ display: 'inline' }}>
              {/* key chip */}
              <span
                style={{
                  display: 'inline-block',
                  verticalAlign: 'baseline',
                  background: 'rgba(8, 108, 106, .1)',
                  border: '1px solid rgba(8, 108, 106, .15)',
                  color: 'inherit',
                  borderRadius: 8,
                  padding: `${CHIP_PAD_Y}px 8px`,
                  marginRight: 6,
                  marginBottom: 6,     // prevents overlap on wrap
                  fontWeight: 400,
                  lineHeight: `${CHIP_LINE_HEIGHT}px`,
                }}
              >
                {k}:
              </span>

              {/* value */}
              <span
                style={{
                  display: 'inline-block',
                  verticalAlign: 'baseline',
                  marginRight: 12,
                  marginBottom: 6,     // keeps baseline spacing consistent
                  lineHeight: `${CHIP_LINE_HEIGHT}px`,
                }}
              >
                {value}
              </span>
            </span>
          );
        })}
      </EuiText>
    );
  };

TokenStream.propTypes = {
  doc: PropTypes.object,
};

/** ------------------ expanded view: Table | JSON tabs ------------------ */

const ExpandedDoc = ({ doc }) => {
  const rows = useMemo(
    () =>
      Object.entries(doc || {}).map(([k, v]) => ({
        key: k,
        value: typeof v === 'number' ? v.toLocaleString() : String(v ?? '-'),
      })),
    [doc]
  );

  // *** No chip styling here (plain text like before) ***
  const table = (
    <EuiInMemoryTable
      items={rows}
      columns={[
        {
          field: 'key',
          name: 'Field',
          sortable: true,
          render: (k) => (
            <EuiText size="s" style={{ fontFamily: 'monospace' }}>
              {k}
            </EuiText>
          ),
          width: '40%',
        },
        {
          field: 'value',
          name: 'Value',
          render: (v) => <EuiText size="s">{v}</EuiText>,
        },
      ]}
      sorting
      pagination={{ pageSizeOptions: [50, 100, 200], initialPageSize: 50 }}
      data-test-subj="ppl-preview-kv-table"
    />
  );

  const json = (
    <EuiCodeBlock
      language="json"
      isCopyable
      paddingSize="m"
      fontSize="s"
      overflowHeight={360}
    >
      {JSON.stringify(doc, null, 2)}
    </EuiCodeBlock>
  );

  return (
    <EuiTabbedContent
      tabs={[
        { id: 'tab-table', name: 'Table', content: <div style={{ padding: 12 }}>{table}</div> },
        { id: 'tab-json', name: 'JSON', content: <div style={{ padding: 12 }}>{json}</div> },
      ]}
      initialSelectedTab={{ id: 'tab-table' }}
      autoFocus="selected"
    />
  );
};

ExpandedDoc.propTypes = {
  doc: PropTypes.object,
};

/** ------------------ main component ------------------ */

export const PplPreviewTable = ({ docs, isLoading = false }) => {
  const list = Array.isArray(docs) ? docs : [];

  if (isLoading) {
    return <EuiText size="s">Loading preview…</EuiText>;
  }
  if (!list.length) {
    return <EuiText size="s" color="subdued">No preview rows.</EuiText>;
  }

  return (
    <div data-test-subj="ppl-preview-container">
      {list.map((doc, i) => (
        <EuiPanel hasBorder paddingSize="m" key={i} style={{ marginBottom: 12 }}>
          {/* collapsed token chips like Discover’s _source */}
          <TokenStream doc={doc} />
          <EuiHorizontalRule margin="s" />
          {/* expandable “Expanded document” with Table | JSON */}
          <EuiAccordion
            id={`doc-${i}`}
            buttonContent={<EuiText size="s"><strong>Expanded document</strong></EuiText>}
            paddingSize="m"
          >
            <ExpandedDoc doc={doc} />
          </EuiAccordion>
        </EuiPanel>
      ))}
      <EuiSpacer size="m" />
    </div>
  );
};

PplPreviewTable.propTypes = {
  docs: PropTypes.arrayOf(PropTypes.object),
  isLoading: PropTypes.bool,
};
