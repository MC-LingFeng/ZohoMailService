import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChartNoAxesCombined,
  CirclePlus,
  Inbox,
  Mail,
  Send,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { dateLabel } from '../api';
import {
  Avatar,
  EmptyState,
  InlineLink,
  PageTitle,
  Spinner,
} from '../components/ui';
import { useWorkspace } from '../workspace';

export default function HomePage() {
  const { overview, activity, accounts, loading, status } = useWorkspace();
  const stats = [
    {
      label: '已接入邮箱',
      value: overview?.accountCount,
      icon: Users,
      foot: '集中管理，轻松切换',
      accent: false,
    },
    {
      label: '未读邮件',
      value: overview?.unreadCount,
      icon: Inbox,
      foot: '已缓存账号的未读统计',
      accent: true,
    },
    {
      label: '今日已发送',
      value: overview?.sentToday,
      icon: Send,
      foot: '通过 ZoHome 发送的邮件',
      accent: false,
    },
    {
      label: '连接正常',
      value: overview?.connectedCount,
      icon: ShieldCheck,
      foot: '授权状态以最近请求为准',
      accent: false,
    },
  ];
  return (
    <div className="page-wrap">
      <PageTitle
        eyebrow="Your mail, at home"
        title="欢迎回到 ZoHome。"
        description="把分散的邮箱聚在一起，让每一封重要邮件都有归处。"
        action={
          <Link to="/mail" className="btn-secondary">
            打开邮件工作台
            <ArrowUpRight size={14} />
          </Link>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, foot, accent }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">{label}</span>
              <span
                className={
                  accent ? 'stat-icon bg-accent-muted text-accent' : 'stat-icon'
                }
              >
                <Icon size={17} strokeWidth={1.6} />
              </span>
            </div>
            <div className="mt-3 text-[32px] leading-none font-semibold tracking-tight tabular-nums">
              {value === undefined ? '—' : value.toLocaleString()}
              <span className="ml-2 text-[11px] font-normal text-subtle">
                {label.includes('邮件') || label.includes('发送') ? '封' : '个'}
              </span>
            </div>
            <p className="mt-3 text-[10px] text-subtle">{foot}</p>
          </div>
        ))}
      </div>
      <div className="mb-6 grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <section className="relative isolate overflow-hidden rounded-2xl bg-brand-800 px-7 py-8 text-white md:px-9 md:py-10">
          <div className="relative z-10 max-w-[72%] sm:max-w-[65%]">
            <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-[9px] tracking-wider text-brand-200">
              <span className="size-1.5 rounded-full bg-lime-soft" />
              多邮箱，一个家
            </span>
            <h2 className="text-[27px] leading-[1.55] font-medium tracking-tight md:text-[32px]">
              少一点来回切换，
              <br />
              多一点从容专注。
            </h2>
            <p className="mt-3 max-w-72 text-[11px] leading-6 text-brand-200">
              查看收件箱、查阅垃圾邮件、发送新消息。
              <br className="hidden sm:block" />
              你的邮箱日常，在这里一次完成。
            </p>
            <Link
              to="/accounts"
              className="mt-6 inline-flex items-center gap-3 rounded-lg bg-lime-soft px-4 py-2.5 text-[11px] font-semibold text-brand-900"
            >
              管理我的邮箱
              <ArrowRight size={14} />
            </Link>
          </div>
          <div
            className="pointer-events-none absolute -right-9 top-12 flex size-64 items-center justify-center rounded-full border border-white/5 sm:right-0 md:right-3"
            aria-hidden="true"
          >
            <div className="absolute size-52 rounded-full border border-white/10" />
            <div className="absolute size-40 rounded-full border border-white/10" />
            <div className="absolute right-7 top-9 flex size-10 -rotate-12 items-center justify-center rounded-xl bg-sand text-brand-700 shadow-lg">
              <Inbox size={20} />
            </div>
            <div className="absolute right-12 bottom-5 flex size-9 rotate-12 items-center justify-center rounded-xl bg-brand-500 text-brand-100">
              <Send size={17} />
            </div>
            <div className="relative flex h-28 w-36 -rotate-6 items-center justify-center rounded-2xl border border-white/20 bg-leaf text-brand-700 shadow-2xl">
              <Mail size={66} strokeWidth={1.1} />
              <span className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full border-4 border-brand-800 bg-lime-soft">
                <Check size={12} strokeWidth={3} />
              </span>
            </div>
          </div>
        </section>
        <section className="panel p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="section-title">你的邮箱，可以更有序</h2>
            <Zap size={16} className="text-brand-500" />
          </div>
          {[
            {
              icon: Users,
              title: '多个账号，随时切换',
              text: '统一管理账号与分组，告别反复登录。',
              to: '/accounts',
            },
            {
              icon: Inbox,
              title: '收件箱与垃圾邮件，一目了然',
              text: '按邮箱查看邮件，不遗漏重要消息。',
              to: '/mail',
            },
            {
              icon: Send,
              title: '选好身份，轻松发出',
              text: '明确发件账号，发送之前再次核对。',
              to: '/mail?compose=1',
            },
            {
              icon: ChartNoAxesCombined,
              title: '邮箱返利记录，集中掌握',
              text: '记录返利网与 offer，对比收益、成本和转化。',
              to: '/rebates',
            },
          ].map(({ icon: Icon, title, text, to }, index) => (
            <Link
              to={to}
              key={title}
              className={`group flex items-start gap-3.5 py-4 ${index < 3 ? 'border-b border-line-soft' : ''}`}
            >
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-accent">
                <Icon size={17} strokeWidth={1.6} />
              </span>
              <div className="flex-1">
                <h3 className="text-xs font-medium group-hover:text-accent">
                  {title}
                </h3>
                <p className="mt-1.5 text-[10px] leading-5 text-subtle">
                  {text}
                </p>
              </div>
              <ArrowUpRight
                size={14}
                className="mt-1 text-faint transition-colors group-hover:text-accent-hover"
              />
            </Link>
          ))}
        </section>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line-soft px-6 py-5">
            <h2 className="section-title">
              最近动态
              <span className="ml-2 text-[10px] font-normal text-subtle">
                {status.mode === 'demo' ? '演示工作区' : '当前工作区'}
              </span>
            </h2>
            <span className="text-[10px] text-subtle">最近 5 条</span>
          </div>
          {loading ? (
            <Spinner />
          ) : activity.length ? (
            <div className="divide-y divide-line-soft">
              {activity.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-6 py-4"
                >
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full ${item.type === 'send' ? 'bg-info-surface text-info-ink' : 'bg-accent-muted text-accent'}`}
                  >
                    {item.type === 'send' ? (
                      <ArrowUpRight size={15} />
                    ) : item.type === 'connect' ? (
                      <CirclePlus size={15} />
                    ) : (
                      <ArrowDownLeft size={15} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs">{item.title}</p>
                    <p className="mt-1 truncate text-[10px] text-subtle">
                      {item.accountEmail}
                    </p>
                  </div>
                  <time className="shrink-0 text-[10px] text-subtle">
                    {dateLabel(item.createdAt, true)}
                  </time>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="工作区准备好了"
              description="接入第一个邮箱后，连接、刷新和发件记录会显示在这里。"
            />
          )}
        </section>
        <div className="space-y-5">
          <section className="panel p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="section-title">邮箱速览</h2>
              <InlineLink to="/accounts">全部账号</InlineLink>
            </div>
            {accounts.length ? (
              <div className="space-y-4">
                {accounts.slice(0, 3).map((account) => (
                  <Link
                    to={`/mail?account=${account.id}`}
                    key={account.id}
                    className="flex items-center gap-3"
                  >
                    <Avatar name={account.name || account.email} small />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {account.name}
                      </p>
                      <p className="mt-1 truncate text-[10px] text-subtle">
                        {account.email}
                      </p>
                    </div>
                    {account.status === 'connected' ? (
                      <span
                        className="size-1.5 rounded-full bg-brand-400"
                        aria-label="连接正常"
                      />
                    ) : (
                      <span className="badge-amber">待处理</span>
                    )}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="py-4 text-xs leading-6 text-subtle">
                还没有接入邮箱，从添加一个账号开始吧。
              </p>
            )}
          </section>
          <Link
            to="/guide"
            className="group flex items-center gap-4 rounded-2xl border border-olive-line bg-olive-soft p-5"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface/70 text-accent">
              <BookOpen size={21} strokeWidth={1.5} />
            </span>
            <div className="flex-1">
              <h2 className="text-xs font-medium text-ink">
                第一次使用 ZoHome？
              </h2>
              <p className="mt-1.5 text-[10px] text-muted">
                从连接邮箱到发送邮件，几步就上手。
              </p>
            </div>
            <ArrowRight
              size={16}
              className="text-accent transition-transform group-hover:translate-x-1"
            />
          </Link>
        </div>
      </div>
      <div className="mt-7 flex items-start gap-2 text-[10px] leading-5 text-subtle">
        <CheckCircle2 size={13} className="mt-1 shrink-0 text-brand-400" />
        <span>
          {status.mode === 'demo'
            ? '当前展示的是演示数据，你可以自由体验阅读、分组与模拟发件。'
            : '使用 Zoho 官方 API 连接邮箱；授权信息仅由本地服务端保存。'}{' '}
          最近同步：{dateLabel(overview?.lastSyncedAt || null, true)}
        </span>
      </div>
    </div>
  );
}
