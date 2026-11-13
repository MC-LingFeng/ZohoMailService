import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, Banknote, BarChart3, CircleDollarSign, Wallet } from 'lucide-react';
import { init, use, type ComposeOption } from 'echarts/core';
import { BarChart, LineChart, type BarSeriesOption, type LineSeriesOption } from 'echarts/charts';
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  type AriaComponentOption,
  type DataZoomComponentOption,
  type GridComponentOption,
  type LegendComponentOption,
  type TooltipComponentOption,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import {
  aggregateOfferComparisons,
  comparisonKey,
  conversionMultiple,
  formatConversion,
  formatConversionApprox,
  sortComparisons,
  type ComparisonSort,
} from '../rebates';
import { useTheme } from '../theme';
import type { RebateList } from '../types';
import { Spinner } from './ui';

use([BarChart, LineChart, AriaComponent, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

type ChartOption = ComposeOption<
  BarSeriesOption | LineSeriesOption | AriaComponentOption | DataZoomComponentOption |
  GridComponentOption | LegendComponentOption | TooltipComponentOption
>;

const amount = (value: number) => new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value);
const compact = (value: number) => new Intl.NumberFormat('zh-CN', {
  notation: 'compact', maximumFractionDigits: 1,
}).format(value);
const shorten = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length - 1)}…` : value;

export default function RebateOverview({ data, loading }: {
  data: RebateList | null;
  loading: boolean;
}) {
  const { resolved } = useTheme();
  const [sort, setSort] = useState<ComparisonSort>('totalRevenue');
  const container = useRef<HTMLDivElement>(null);
  const items = useMemo(() => sortComparisons(aggregateOfferComparisons(data?.comparison ?? []), sort), [data, sort]);
  const totals = data?.summary;
  const netProfit = totals
    ? (Math.round(totals.totalRevenue * 100) - Math.round(totals.totalCost * 100)) / 100
    : null;

  useEffect(() => {
    const element = container.current;
    if (!element || loading || items.length === 0) return;
    const chart = init(element, undefined, { renderer: 'svg' });
    const css = getComputedStyle(element);
    const color = (name: string) => css.getPropertyValue(`--color-${name}`).trim();
    const revenueColor = color('accent');
    const unsettledColor = color('revenue-unsettled');
    const costColor = color('warning-ink');
    const conversionColor = color('info-ink');
    const muted = color('muted');
    const line = color('line');
    const fontFamily = css.fontFamily;
    const itemByKey = new Map(items.map((item) => [comparisonKey(item), item]));
    const windowSize = () => Math.min(8, Math.max(2, Math.floor(element.clientWidth / 130)));
    let visibleCount = windowSize();
    const labelWidth = () => Math.max(36, (element.clientWidth - 126) / Math.min(visibleCount, items.length) - 12);
    const zoomOptions = (count: number): DataZoomComponentOption[] => items.length > count ? [
      {
        type: 'slider', xAxisIndex: 0, bottom: 10, height: 22,
        startValue: 0, endValue: count - 1, minValueSpan: 1,
        showDetail: false, brushSelect: false,
        borderColor: line, fillerColor: color('accent-muted'),
        textStyle: { color: muted },
      },
      { type: 'inside', xAxisIndex: 0, startValue: 0, endValue: count - 1, zoomOnMouseWheel: false, moveOnMouseWheel: true },
    ] : [];
    const option: ChartOption = {
      animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      textStyle: { fontFamily, color: muted, fontSize: 13 },
      aria: {
        enabled: true,
        label: { description: '合并当前筛选结果中的同名 Offer。柱形展示合计已结款收益、未结款收益和成本，折线展示合计收益除以合计成本的倍数。完整数值见下方对比明细。' },
      },
      legend: {
        type: 'scroll', top: 0, left: 0, right: 0,
        itemWidth: 12, itemHeight: 8, itemGap: 18,
        textStyle: { color: muted, fontFamily, fontSize: 13 },
        data: ['已结款收益', '未结款收益', '成本', '转化（收益/成本）'],
      },
      grid: { top: 82, bottom: items.length > visibleCount ? 132 : 96, left: 62, right: 64 },
      tooltip: {
        trigger: 'axis', confine: true, renderMode: 'html', enterable: true,
        backgroundColor: color('surface'), borderColor: line,
        textStyle: { color: color('ink'), fontFamily, fontSize: 14, lineHeight: 24 },
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const point = Array.isArray(params) ? params[0] : params;
          const item = items[point?.dataIndex];
          if (!item) return '';
          const ratio = formatConversionApprox(item.totalCost, item.totalRevenue);
          // textContent keeps saved names literal, including any HTML-like input.
          const content = document.createElement('div');
          content.style.maxWidth = `${Math.max(160, Math.min(440, element.clientWidth - 30))}px`;
          content.style.maxHeight = `${element.clientHeight - 40}px`;
          content.style.whiteSpace = 'pre-wrap';
          content.style.overflowWrap = 'anywhere';
          content.style.overflowY = 'auto';
          content.textContent = [
            item.offerName || '未填写 Offer',
            `收益  ${amount(item.totalRevenue)}`,
            `已结款  ${amount(item.settledRevenue)}    未结款  ${amount(item.unsettledRevenue)}`,
            `成本（USD）  ${amount(item.totalCost)}`,
            `转化（成本:收益）  ${formatConversion(item.totalCost, item.totalRevenue)}`,
            ratio === '—' ? '转化倍数  —（成本为 0）' : `转化倍数  ≈ 1:${ratio}`,
            `${item.recordCount} 条记录`,
          ].join('\n');
          return content;
        },
      },
      xAxis: {
        type: 'category', data: items.map(comparisonKey),
        axisTick: { show: false }, axisLine: { lineStyle: { color: line } },
        axisLabel: {
          interval: 0, color: muted, fontSize: 12, lineHeight: 20, margin: 14,
          width: labelWidth(), overflow: 'truncate',
          formatter: (value: string) => {
            // ECharts resets the label index inside the zoomed window.
            const item = itemByKey.get(value);
            if (!item) return '';
            return shorten(item.offerName || '未填写 Offer', 24);
          },
        },
      },
      yAxis: [
        {
          type: 'value', name: '金额', min: 0, splitNumber: 4,
          nameTextStyle: { color: muted, align: 'left' },
          axisLabel: { color: muted, formatter: compact },
          splitLine: { lineStyle: { color: line, type: 'dashed' } },
        },
        {
          type: 'value', name: '收益/成本（倍）', min: 0, splitNumber: 4,
          nameTextStyle: { color: conversionColor, align: 'right' },
          axisLabel: { color: conversionColor, formatter: (value: number) => `${compact(value)}×` },
          splitLine: { show: false },
        },
      ],
      dataZoom: zoomOptions(visibleCount),
      series: [
        { name: '已结款收益', type: 'bar', stack: 'revenue', barMaxWidth: 28, itemStyle: { color: revenueColor }, data: items.map((item) => item.settledRevenue) },
        { name: '未结款收益', type: 'bar', stack: 'revenue', barMaxWidth: 28, itemStyle: { color: unsettledColor }, data: items.map((item) => item.unsettledRevenue) },
        { name: '成本', type: 'bar', barMaxWidth: 28, itemStyle: { color: costColor, borderRadius: [3, 3, 0, 0] }, data: items.map((item) => item.totalCost) },
        {
          name: '转化（收益/成本）', type: 'line', yAxisIndex: 1,
          symbolSize: 8, connectNulls: false, smooth: false,
          itemStyle: { color: conversionColor }, lineStyle: { width: 2 },
          data: items.map((item) => conversionMultiple(item.totalCost, item.totalRevenue)),
        },
      ],
    };
    chart.setOption(option);
    const observer = new ResizeObserver(() => {
      chart.resize();
      const nextCount = windowSize();
      chart.setOption({ xAxis: { axisLabel: { width: labelWidth() } } });
      if (nextCount === visibleCount) return;
      visibleCount = nextCount;
      chart.setOption({
        grid: { bottom: items.length > visibleCount ? 132 : 96 },
        xAxis: { axisLabel: { width: labelWidth() } },
        dataZoom: zoomOptions(visibleCount),
      }, { replaceMerge: ['dataZoom'] });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [items, loading, resolved]);

  const cards = [
    { title: '总收益', value: totals ? amount(totals.totalRevenue) : '—', Icon: CircleDollarSign, color: 'text-accent', caption: totals ? `已结款 ${amount(totals.settledRevenue)} · 未结款 ${amount(totals.unsettledRevenue)}` : '已结款与未结款收益' },
    { title: '总成本（USD）', value: totals ? amount(totals.totalCost) : '—', Icon: Wallet, color: 'text-warning-ink', caption: '包含已封户记录的成本' },
    { title: '净利润（USD）', value: netProfit === null ? '—' : amount(netProfit), Icon: Banknote, color: netProfit !== null && netProfit < 0 ? 'text-danger-ink' : 'text-accent', caption: '总收益 − 总成本' },
    { title: '整体转化', value: totals ? formatConversion(totals.totalCost, totals.totalRevenue) : '—', Icon: ArrowDownUp, color: 'text-info-ink', caption: totals ? `成本:收益 · ${totals.totalCost > 0 ? `≈ 1:${formatConversionApprox(totals.totalCost, totals.totalRevenue)}` : '成本为 0，倍数为 —'}` : '按汇总成本与收益计算' },
  ];

  return (
    <div className="mb-5 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ title, value, Icon, color, caption }) => (
          <section className="panel min-w-0 p-5" aria-label={title} key={title}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-muted">{title}</h2>
              <Icon size={17} className={color} aria-hidden="true" />
            </div>
            <p className="mt-3 break-all text-2xl font-semibold tracking-tight tabular-nums">{loading ? '—' : value}</p>
            <p className="mt-2 text-[12px] leading-5 tabular-nums text-subtle">{caption}</p>
          </section>
        ))}
      </div>

      <section className="panel min-w-0 p-5" aria-labelledby="offer-comparison-heading">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="offer-comparison-heading" className="section-title">Offer 收益、成本与转化对比</h2>
            <p className="mt-1.5 text-[13px] leading-6 text-muted">合并当前筛选结果中的同名 Offer，统一汇总收益和成本；转化按合计收益 ÷ 合计成本计算。</p>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            排序
            <select className="input w-auto py-2" value={sort} onChange={(event) => setSort(event.target.value as ComparisonSort)}>
              <option value="totalRevenue">收益从高到低</option>
              <option value="totalCost">成本从高到低</option>
              <option value="conversion">转化倍数从高到低</option>
            </select>
          </label>
        </div>
        {loading ? <Spinner label="正在汇总 Offer" /> : items.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-sm text-subtle">
            <BarChart3 size={26} strokeWidth={1.2} aria-hidden="true" />
            暂无可对比的 Offer 记录
          </div>
        ) : (
          <>
            <div ref={container} className="h-[440px] w-full sm:h-[460px]" />
            <p className="mt-2 text-[12px] leading-5 text-subtle">共 {items.length} 个 Offer · 悬浮查看合计收益、成本与转化；拖动底部滑块可查看其余 Offer。左右轴分别为金额与转化倍数。</p>
            <details className="mt-4 border-t border-line-soft pt-3">
              <summary className="cursor-pointer text-sm text-muted">查看全部对比明细（{items.length} 项）</summary>
              <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Offer 汇总对比明细，可左右滚动">
                <table className="data-table w-full min-w-[760px] text-left">
                  <caption className="sr-only">当前筛选结果按同名 Offer 合并收益与成本，顺序与图表一致</caption>
                  <thead className="bg-surface-muted text-muted">
                    <tr>{['Offer', '总收益', '已结款 / 未结款', '成本（USD）', '转化（成本:收益）', '记录数'].map((label) => <th className="px-3 py-3 font-medium" key={label}>{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr className="border-b border-line-soft" key={comparisonKey(item)}>
                        <td className="max-w-64 break-words px-3 py-3 font-medium">{item.offerName || '未填写 Offer'}</td>
                        <td className="px-3 py-3 tabular-nums text-accent">{amount(item.totalRevenue)}</td>
                        <td className="px-3 py-3 tabular-nums text-muted">{amount(item.settledRevenue)} / {amount(item.unsettledRevenue)}</td>
                        <td className="px-3 py-3 tabular-nums text-warning-ink">{amount(item.totalCost)}</td>
                        <td className="px-3 py-3 tabular-nums">{formatConversion(item.totalCost, item.totalRevenue)}<span className="mt-1 block text-muted">{item.totalCost > 0 ? `≈ 1:${formatConversionApprox(item.totalCost, item.totalRevenue)}` : '—（成本为 0）'}</span></td>
                        <td className="px-3 py-3 tabular-nums text-muted">{item.recordCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
