import React, { useState, useEffect, useRef } from 'react';
import { 
  ExternalLink, 
  Globe, 
  Gauge, 
  CheckCircle2, 
  Copy, 
  Check 
} from 'lucide-react';
import { fetchIpAndIspInfo, SpeedtestRunner, SpeedtestProgress } from '../services/networkTester';
import { SpeedtestResult } from '../types/wifi';

interface ExternalSpeedtestService {
  id: string;
  name: string;
  title: string;
  description: string;
  url: string;
  badge: string;
  badgeColor: string;
  recommendedFor: string;
  iconBg: string;
}

const SPEEDTEST_SERVICES: ExternalSpeedtestService[] = [
  {
    id: 'yandex',
    name: 'Яндекс Интернетометр',
    title: 'yandex.ru/internet',
    description: 'Измерение скорости интернета, определение IPv4/IPv6 и геопозиции.',
    url: 'https://yandex.ru/internet',
    badge: 'Россия (CDN)',
    badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    recommendedFor: 'Проверка скорости до российских серверов',
    iconBg: 'from-rose-500 to-amber-600',
  },
  {
    id: 'ookla',
    name: 'Speedtest by Ookla',
    title: 'speedtest.net',
    description: 'Всемирный стандарт тестирования пропускной способности каналов связи.',
    url: 'https://www.speedtest.net',
    badge: 'Глобальный',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    recommendedFor: 'Мультисерверное тестирование',
    iconBg: 'from-cyan-500 to-blue-600',
  },
  {
    id: '2ip',
    name: '2ip.ru Скорость',
    title: '2ip.ru/speed',
    description: 'Популярный российский сервис проверки скорости и параметров IP.',
    url: 'https://2ip.ru/speed/',
    badge: '2IP.ru',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    recommendedFor: 'Оценка пинга и провайдера в РФ',
    iconBg: 'from-emerald-500 to-teal-600',
  },
  {
    id: 'fast',
    name: 'Fast.com (Netflix)',
    title: 'fast.com',
    description: 'Тест скорости до CDN серверов Netflix в один клик.',
    url: 'https://fast.com/ru/',
    badge: 'Netflix CDN',
    badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    recommendedFor: 'Проверка загрузки видеоконтента',
    iconBg: 'from-purple-500 to-indigo-600',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Speed Test',
    title: 'speed.cloudflare.com',
    description: 'Тест скорости, задержки, джиттера и Bufferbloat (90th percentile).',
    url: 'https://speed.cloudflare.com/',
    badge: 'Bufferbloat Test',
    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    recommendedFor: 'Проверка качества буферизации в играх',
    iconBg: 'from-amber-500 to-orange-600',
  },
];

export const SpeedtestDashboard: React.FC<{ onResult?: (result: SpeedtestResult) => void }> = ({ onResult }) => {
  const [netInfo, setNetInfo] = useState<{
    ip?: string;
    isp?: string;
    city?: string;
  }>({});
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [testError, setTestError] = useState('');
  const [result, setResult] = useState<SpeedtestResult | null>(null);
  const runnerRef = useRef<SpeedtestRunner | null>(null);
  const [progress, setProgress] = useState<SpeedtestProgress>({
    phase: 'idle', currentSpeedMbps: 0, downloadSpeedMbps: 0, uploadSpeedMbps: 0,
    pingMs: 0, jitterMs: 0, progressPercent: 0, bufferbloatLatencyMs: 0,
    bufferbloatGrade: 'N/A', historyPoints: [],
  });

  useEffect(() => {
    fetchIpAndIspInfo().then(info => {
      if (info) {
        setNetInfo({
          ip: info.ip,
          isp: info.isp,
          city: info.city,
        });
      }
    });
  }, []);

  const runInternalSpeedtest = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setTestError('');
    setResult(null);
    const runner = new SpeedtestRunner(setProgress);
    runnerRef.current = runner;
    try {
      const finalResult = await runner.run();
      setResult(finalResult);
      onResult?.(finalResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Тест скорости завершился с ошибкой.';
      setTestError(message);
      setProgress(previous => ({ ...previous, phase: 'error' }));
    } finally {
      setIsRunning(false);
      runnerRef.current = null;
    }
  };

  const stopInternalSpeedtest = () => {
    runnerRef.current?.stop();
  };

  const handleCopy = (url: string, id: string) => {
    navigator.clipboard?.writeText(url);
    setCopiedUrl(id);
    setTimeout(() => {
      setCopiedUrl(prev => prev === id ? null : prev);
    }, 2000);
  };

  return (
    <div className="space-y-4 sm:space-y-6 w-full max-w-full overflow-hidden">
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20 shrink-0">
              <Gauge className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-100">Тестирование скорости интернета</h2>
              <p className="text-xs text-slate-400">Быстрый запуск лучших измерительных платформ связи</p>
            </div>
          </div>
          
          <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800/90 text-xs font-mono space-y-1 w-full sm:w-auto">
            <div className="flex items-center gap-2 text-slate-400">
              <span>Провайдер:</span>
              <strong className="text-cyan-300 font-sans">{netInfo.isp || 'Не определён'}</strong>
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <span>IP адрес:</span>
              <strong className="text-slate-200">{netInfo.ip || '—'}</strong>
              {netInfo.city && <span className="text-slate-500 font-sans">• {netInfo.city}</span>}
            </div>
          </div>
        </div>
        
        <div className="p-3 rounded-2xl bg-cyan-950/30 border border-cyan-500/30 text-xs text-cyan-200/90 flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>Все сервисы открываются в один тап в браузере или приложении</span>
        </div>
      </div>

      <section className="rounded-3xl border border-cyan-500/30 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-100">Встроенный тест соединения</h3>
            <p className="text-xs text-slate-400 mt-1">Реальная загрузка и отправка данных через Cloudflare, ICMP ping с Android.</p>
          </div>
          <div className="flex gap-2">
            {!isRunning ? (
              <button type="button" onClick={runInternalSpeedtest} className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-colors">
                Запустить тест
              </button>
            ) : (
              <button type="button" onClick={stopInternalSpeedtest} className="px-4 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold transition-colors">
                Остановить
              </button>
            )}
          </div>
        </div>

        <div className="h-2 rounded-full bg-slate-800 overflow-hidden" aria-label={`Прогресс теста ${progress.progressPercent}%`}>
          <div className="h-full bg-cyan-400 transition-all duration-300" style={{ width: `${progress.progressPercent}%` }} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <span>Этап: {({ idle: 'готов', ping: 'пинг', download: 'загрузка', upload: 'отдача', bufferbloat: 'задержка под нагрузкой', completed: 'завершён', error: 'ошибка' } as Record<string, string>)[progress.phase]}</span>
          <span>{progress.progressPercent}%</span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Скачивание', value: result ? result.downloadMbps : progress.downloadSpeedMbps, suffix: 'Мбит/с' },
            { label: 'Отдача', value: result ? result.uploadMbps : progress.uploadSpeedMbps, suffix: 'Мбит/с' },
            { label: 'Ping', value: result ? result.pingMs : progress.pingMs, suffix: 'мс' },
            { label: 'Jitter', value: result ? result.jitterMs : progress.jitterMs, suffix: 'мс' },
          ].map(metric => (
            <div key={metric.label} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3">
              <div className="text-[11px] text-slate-400">{metric.label}</div>
              <div className="mt-1 text-xl font-black text-slate-100 tabular-nums">
                {(isRunning || result) && metric.value > 0 ? metric.value.toFixed(1) : '—'}
                <span className="ml-1 text-[10px] font-medium text-slate-500">{metric.suffix}</span>
              </div>
            </div>
          ))}
        </div>
        {progress.historyPoints.length > 0 && (
          <div className="flex h-12 items-end gap-1 rounded-xl bg-slate-950/70 px-3 py-2" aria-label="График фактически измеренной скорости">
            {progress.historyPoints.map((point, index) => {
              const max = Math.max(...progress.historyPoints, 1);
              return <div key={`${index}-${point}`} title={`${point.toFixed(1)} Мбит/с`} className="flex-1 min-w-0 rounded-t-sm bg-cyan-500/80" style={{ height: `${Math.max(4, point / max * 100)}%` }} />;
            })}
          </div>
        )}
        {result && <p className="text-[11px] text-slate-400">Измерено в {result.timestamp}; сервер: {result.server}. Bufferbloat: {result.bufferbloatGrade === 'N/A' ? 'нет данных (ICMP не ответил)' : result.bufferbloatGrade}{result.bufferbloatLatencyMs ? ` (+${result.bufferbloatLatencyMs.toFixed(1)} мс)` : ''}. Потери ICMP: {result.packetLossPct}%.</p>}
        {testError && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">{testError}</div>}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SPEEDTEST_SERVICES.map(service => (
          <div
            key={service.id}
            className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 transition-all flex flex-col justify-between space-y-4 shadow-lg group hover:shadow-cyan-500/5"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-2xl bg-gradient-to-tr ${service.iconBg} text-white shadow-md shrink-0`}>
                    <Globe className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm sm:text-base text-slate-100 group-hover:text-cyan-300 transition-colors">
                      {service.name}
                    </h3>
                    <span className="text-[11px] font-mono text-slate-400">
                      {service.title}
                    </span>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${service.badgeColor} shrink-0`}>
                  {service.badge}
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {service.description}
              </p>
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 font-medium">
                <span className="text-slate-500">Назначение:</span>
                <span className="text-slate-300">{service.recommendedFor}</span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2">
              <a
                href={service.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 flex items-center justify-center gap-2 shadow-md shadow-cyan-500/20 transition-all cursor-pointer active:scale-95 select-none"
              >
                <span>Запустить тест</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={() => handleCopy(service.url, service.id)}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer"
                title="Копировать ссылку"
              >
                {copiedUrl === service.id ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
