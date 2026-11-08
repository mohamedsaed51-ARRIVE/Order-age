import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export default function ChartBox({ type, labels, datasets, theme, horizontal, stacked, pct, legend = true }) {
  const ref = useRef(null);
  const key = JSON.stringify([type, labels, datasets, theme, horizontal, stacked, pct, legend]);
  useEffect(() => {
    const grid = css('--chart-grid'), label = css('--chart-label');
    const axis = (isVal) => ({ stacked: !!stacked, grid: { color: grid }, ticks: { color: label, font: { family: 'Cairo, Inter, sans-serif', size: 11 } }, ...(isVal && pct ? { ticks: { color: label, callback: (v) => v + '%' } } : {}), ...(isVal ? { beginAtZero: true } : {}) });
    const circular = type === 'doughnut';
    const chart = new Chart(ref.current, {
      type,
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x',
        plugins: { legend: { display: legend, labels: { color: label, usePointStyle: true, font: { family: 'Cairo, Inter, sans-serif', size: 12 } } }, tooltip: { rtl: true, titleFont: { family: 'Cairo' }, bodyFont: { family: 'Cairo' } } },
        ...(circular ? { cutout: '62%' } : { scales: { x: axis(!!horizontal), y: axis(!horizontal) } })
      }
    });
    return () => chart.destroy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <canvas ref={ref} role="img" aria-label="رسم بياني" />;
}
