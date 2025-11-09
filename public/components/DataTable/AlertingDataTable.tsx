/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EuiBasicTable, EuiBasicTableColumn } from '@elastic/eui';
import classNames from 'classnames';
import './AlertingDataTable.scss';

export interface AlertingDataTableColumn {
  field: string;
  name: string;
  render?: (value: any, item: Record<string, any>) => React.ReactNode;
  truncateText?: boolean;
  className?: string;
}

interface AlertingDataTableProps {
  pplResponse: any;
  isLoading?: boolean;
  columns?: AlertingDataTableColumn[];
  className?: string;
  services?: any;
}

const defaultRender = (value: any) => {
  if (value == null) return '-';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
};

const buildColumnsFromSchema = (schema: Array<{ name: string }>): EuiBasicTableColumn<any>[] => {
  return schema.map((col) => ({
    field: col.name,
    name: col.name,
    render: defaultRender,
    truncateText: true,
    className: 'alertingDataTable__cell',
  }));
};

const rowsFromResponse = (resp: any) => {
  if (resp && Array.isArray(resp.schema) && Array.isArray(resp.datarows)) {
    return resp.datarows.map((row) => {
      const obj: Record<string, any> = {};
      resp.schema.forEach((col: any, idx: number) => {
        obj[col.name] = row[idx];
      });
      return obj;
    });
  }
  if (resp && resp.hits && Array.isArray(resp.hits.hits)) {
    return resp.hits.hits.map((hit: any) => ({
      _id: hit._id,
      _index: hit._index,
      _score: hit._score,
      ...hit._source,
    }));
  }
  return [];
};

export const AlertingDataTable: React.FC<AlertingDataTableProps> = ({
  pplResponse,
  isLoading = false,
  columns,
  className,
}) => {
  const items = rowsFromResponse(pplResponse);
  const schemaColumns = columns || buildColumnsFromSchema(pplResponse?.schema || []);

  return (
    <div className={classNames('alertingDataTable', className)}>
      <EuiBasicTable
        items={items}
        columns={schemaColumns}
        loading={isLoading}
        rowHeader="id"
        className="alertingDataTable__table"
      />
    </div>
  );
};


