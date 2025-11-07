/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import {
  EuiFlexGroup,
  EuiHorizontalRule,
  EuiInMemoryTable,
  EuiPagination,
  EuiPanel,
  EuiSpacer,
  EuiText,
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

export const PplPreviewTable = ({ docs, isLoading = false }) => {
  const list = Array.isArray(docs) ? docs : [];
  const PAGE_SIZE = 5;
  const [pageIndex, setPageIndex] = useState(0);

  const pageCount = Math.ceil(list.length / PAGE_SIZE) || 1;
  const safePageIndex = Math.min(pageIndex, pageCount - 1);

  useEffect(() => {
    setPageIndex(0);
  }, [docs]);

  useEffect(() => {
    if (pageIndex !== safePageIndex) {
      setPageIndex(safePageIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount]);

  const start = safePageIndex * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, list.length);
  const currentDocs = list.slice(start, end).map((doc, idx) => ({
    id: start + idx,
    values: doc,
  }));

  if (isLoading) {
    return <EuiText size="s">Loading preview…</EuiText>;
  }
  if (!list.length) {
    return <EuiText size="s" color="subdued">No preview rows.</EuiText>;
  }

  const columns = Object.keys(currentDocs[0]?.values || {}).map((key) => ({
    field: key,
    name: key,
    render: (_value, item) => {
      const val = item.values[key];
      if (typeof val === 'number') return val.toLocaleString();
      if (val == null) return '-';
      return String(val);
    },
  }));

  const tableItems = currentDocs.map((item) => ({ id: item.id, ...item.values }));

  return (
    <div data-test-subj="ppl-preview-container">
      <EuiPanel hasBorder paddingSize="m" style={{ marginBottom: 12 }}>
        <EuiInMemoryTable
          items={tableItems}
          columns={columns}
          pagination={{ pageSizeOptions: [PAGE_SIZE], initialPageSize: PAGE_SIZE }}
          sorting={false}
          data-test-subj="ppl-preview-table"
        />
      </EuiPanel>
      <EuiSpacer size="m" />
      {list.length > PAGE_SIZE && (
        <EuiFlexGroup justifyContent="spaceBetween" alignItems="center" gutterSize="s">
          <EuiFlexGroup alignItems="center" gutterSize="s">
            <EuiText size="xs" color="subdued">
              {`Showing ${start + 1}-${end} of ${list.length}`}
            </EuiText>
          </EuiFlexGroup>
          <EuiPagination
            pageCount={pageCount}
            activePage={safePageIndex}
            onPageClick={setPageIndex}
          />
        </EuiFlexGroup>
      )}
    </div>
  );
};

PplPreviewTable.propTypes = {
  docs: PropTypes.arrayOf(PropTypes.object),
  isLoading: PropTypes.bool,
};
