'use client';

// recharts 体积约 392KB，占课例页首屏 JS 的三分之一以上。
// 抽成本组件后由 ReportView 用 next/dynamic 按需加载：首屏不再同步下载该 chunk，
// 用户滚到雷达图或等异步块就绪时再取。视觉属性与原实现逐字一致。
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';

export interface ReportRadarDatum {
  dim: string;
  score: number;
  fullMark: number;
}

export default function ReportRadar({ data }: { data: ReportRadarDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid />
        <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: '#5b5468' }} />
        <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 9, fill: '#9aa0b0' }} axisLine={false} />
        <Radar
          name="得分"
          dataKey="score"
          stroke="#5b54e6"
          fill="#5b54e6"
          fillOpacity={0.32}
          dot={{ r: 3, fill: '#5b54e6', strokeWidth: 0 }}
          label={{ position: 'top', fontSize: 11, fontWeight: 600, fill: '#4338ca' }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
