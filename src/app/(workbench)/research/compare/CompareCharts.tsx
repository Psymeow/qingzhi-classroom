'use client';

// recharts 体积约 392KB，占教研对比页首屏 JS 的大部分。
// 抽成本组件后由父页面用 next/dynamic 按需加载，首屏不再同步下载该 chunk。
// 图表属性与原实现逐字一致。
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export interface CompareRadarProps {
  /** 已由父层算好的雷达数据（key 含 dim 与各课系列名） */
  data: Array<Record<string, string | number>>;
  /** 每条雷达对应的 dataKey，与 data 中的系列名一致 */
  seriesKeys: string[];
  /** 与 seriesKeys 一一对应的颜色 */
  colors: string[];
}

export default function CompareRadar({ data, seriesKeys, colors }: CompareRadarProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
        <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
        {seriesKeys.map((key, i) => (
          <Radar
            key={key}
            name={key}
            dataKey={key}
            stroke={colors[i % colors.length]}
            fill={colors[i % colors.length]}
            fillOpacity={0.12}
          />
        ))}
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
