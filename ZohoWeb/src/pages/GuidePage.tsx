import { useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  Check,
  ChartNoAxesCombined,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  FolderOpen,
  Inbox,
  KeyRound,
  MailCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

const chapters = [
  { id: 'connect', label: '连接邮箱' },
  { id: 'organize', label: '管理账号' },
  { id: 'read', label: '查看邮件' },
  { id: 'send', label: '发送邮件' },
  { id: 'rebates', label: '记录返利网' },
  { id: 'faq', label: '常见问题' },
];

const questions = [
  {
    title: 'Client ID 和 Client Secret 需要每次重新填写吗？',
    answer:
      '不需要。首次添加邮箱时，在绑定表单中填写邮箱地址、Client ID 和 Client Secret，授权成功后会与该邮箱关联保存。以后重新授权会复用已保存的应用配置。需要更换应用时，进入「邮箱账号」中的「更换应用配置」重新填写；只有新授权成功且邮箱匹配后，才会替换旧配置。',
  },
  {
    title: '每次切换邮箱，都要重新登录吗？',
    answer:
      '不需要。每个独立邮箱首次接入时，需要分别登录 Zoho 或 Microsoft 并同意授权。授权保存后，ZoHome 会在需要时续期访问令牌，日常切换邮箱无需反复退出、登录。如果你撤销了授权，或邮箱服务要求重新验证，页面会提示重新连接。',
  },
  {
    title: '演示模式会读取我的邮箱或发送真实邮件吗？',
    answer:
      '演示模式只使用示例账号和示例邮件，不会连接真实邮箱。发件操作也只会模拟发送，方便你熟悉整个流程。接入真实账号前，需要由管理员完成服务端配置，并切换到真实邮箱模式。',
  },
  {
    title: '管理 2000 个邮箱，所有邮件都会实时刷新吗？',
    answer:
      '当前版本按需读取你正在查看的邮箱，并使用缓存减少重复请求。手动刷新只针对当前账号，不会同时刷新全部邮箱。2000 个账号的授权规模、可用额度和刷新速度仍需实际验证，不能按账号数量直接累加邮箱服务的 API 配额。',
  },
  {
    title: '为什么会出现读取失败或需要重新授权？',
    answer:
      '请先查看页面的具体错误提示。授权被撤销时，需要重新连接对应账号；遇到请求频率限制时，稍后再试，避免连续点击刷新。免费账号的接口可用性也需要通过实际账号确认。如果问题持续存在，请让管理员检查服务端配置与日志。',
  },
  {
    title: '需要配置 IMAP、SMTP 或把邮箱密码交给 ZoHome 吗？',
    answer:
      '本系统通过 Zoho Mail API 或 Microsoft Graph 读取和发送邮件，不需要配置 IMAP 或 SMTP。连接邮箱时，你会前往对应服务的官方页面登录并授权，ZoHome 使用授权令牌访问邮箱。ZoHome 的系统访问密码与邮箱密码是两回事。',
  },
];

function StepSection({
  id,
  number,
  icon: Icon,
  title,
  description,
  children,
}: {
  id: string;
  number: string;
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="panel scroll-mt-24 overflow-hidden">
      <div className="flex items-start gap-4 border-b border-line-soft p-6 md:p-7">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-muted text-accent">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">STEP {number}</p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <p className="mt-2 text-xs leading-6 text-muted">{description}</p>
        </div>
        <span
          className="hidden text-4xl font-light tracking-tight text-line-soft sm:block"
          aria-hidden="true"
        >
          {number}
        </span>
      </div>
      <div className="space-y-5 p-6 md:p-7">{children}</div>
    </section>
  );
}

function Instruction({
  number,
  children,
}: {
  number: number;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 text-xs leading-6 text-body">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-hover text-[10px] font-semibold text-muted">
        {number}
      </span>
      <span>{children}</span>
    </li>
  );
}

export default function GuidePage() {
  const [setupProvider, setSetupProvider] = useState<'zoho' | 'outlook'>('zoho');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const callbackUrl = new URL(
    `/api/auth/${setupProvider}/callback`,
    window.location.origin,
  ).toString();

  async function copyCallback() {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="page-wrap">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="eyebrow">YOUR ZOHOME HANDBOOK</p>
          <h1 className="page-heading mt-3">几步上手，让邮箱井井有条。</h1>
          <p className="page-description">
            从连接第一个账号开始，在同一个工作台里处理每一封邮件。
          </p>
        </div>
        <span className="badge-muted mt-1 gap-2 px-3 py-2">
          <Clock3 className="size-3.5" aria-hidden="true" />
          预计阅读 3 分钟
        </span>
      </div>

      <div className="mt-7 flex items-center gap-4 rounded-2xl border border-accent-line bg-accent-muted/70 p-5 md:px-6">
        <div className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-surface text-accent sm:flex">
          <BookOpen className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[13px] font-semibold text-accent">
            一个工作台，一套熟悉的操作。
          </p>
          <p className="mt-1 text-xs leading-6 text-accent/80">
            连接邮箱 → 整理账号 → 查看收件箱与垃圾邮件 →
            选择账号发件。首次使用时，可以先在演示模式中体验。
          </p>
        </div>
      </div>

      <nav
        aria-label="使用指南章节"
        className="sticky top-0 z-20 -mx-1 mt-6 mb-6 flex gap-1 overflow-x-auto border-b border-line bg-canvas/95 px-1 backdrop-blur-sm"
      >
        {chapters.map((chapter, index) => (
          <a
            key={chapter.id}
            href={`#${chapter.id}`}
            className="tab gap-2 px-3 md:px-4"
          >
            <span className="text-[10px] text-subtle">0{index + 1}</span>
            {chapter.label}
          </a>
        ))}
      </nav>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-5">
          <StepSection
            id="connect"
            number="01"
            icon={Plus}
            title="把第一个邮箱带回家"
            description="选择邮箱服务并填写应用配置，完成一次官方授权，之后就可以直接切换。"
          >
            <ol className="space-y-3">
              <Instruction number={1}>
                进入「邮箱账号」，点击「添加邮箱」，选择 Zoho 或 Outlook，填写要绑定的邮箱地址、Client
                ID 和 Client Secret。
              </Instruction>
              <Instruction number={2}>
                前往对应服务的
                官方授权页面，确认登录的邮箱与表单中填写的地址一致，再同意所请求的权限。
              </Instruction>
              <Instruction number={3}>
                授权完成后返回
                ZoHome。应用配置会与这个邮箱关联保存，在账号列表中确认连接状态即可。添加其他邮箱时重复以上步骤。
              </Instruction>
            </ol>
            <div className="flex items-start gap-3 rounded-xl bg-surface-muted p-4">
              <ShieldCheck
                className="mt-0.5 size-4 shrink-0 text-accent"
                aria-hidden="true"
              />
              <p className="text-xs leading-6 text-muted">
                邮箱密码只在邮箱服务的
                官方页面输入。若浏览器中登录了其他邮箱，系统会拒绝不匹配的授权，并提示重新选择正确账号；不会把它绑定到你填写的地址。
              </p>
            </div>
            <details className="group rounded-xl border border-line">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-xs font-medium text-body [&::-webkit-details-marker]:hidden">
                <KeyRound className="size-4 text-subtle" aria-hidden="true" />
                首次使用：准备应用信息与服务端配置
                <ChevronDown
                  className="ml-auto size-4 shrink-0 text-subtle transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="space-y-4 border-t border-line-soft p-4 text-xs leading-6 text-muted">
                <label className="block">
                  <span className="field-label">选择要配置的邮箱服务</span>
                  <select
                    className="input"
                    value={setupProvider}
                    onChange={(event) => {
                      setSetupProvider(event.target.value === 'outlook' ? 'outlook' : 'zoho');
                      setCopied(false);
                      setCopyError(false);
                    }}
                  >
                    <option value="zoho">Zoho Mail</option>
                    <option value="outlook">Outlook / Hotmail / Microsoft 365</option>
                  </select>
                </label>
                {setupProvider === 'outlook' ? (
                  <div className="space-y-2">
                    <p>
                      在{' '}
                      <a
                        href="https://entra.microsoft.com/"
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-accent underline underline-offset-4"
                      >
                        Microsoft Entra 管理中心
                      </a>{' '}
                      注册应用。如需同时接入个人 Outlook、Hotmail 和 Microsoft 365，选择允许任意组织目录及个人 Microsoft 账号登录的类型。
                    </p>
                    <p>
                      添加 Microsoft Graph 委托权限 User.Read、Mail.Read、Mail.Send、offline_access。
                      创建客户端密码，将 Application (client) ID 和密码值（Value，非 Secret ID）填入「添加邮箱」。组织邮箱可能需要管理员同意。
                    </p>
                    <p>在「身份验证」中添加 Web 平台，登记下方回调地址：</p>
                  </div>
                ) : <p>
                  在{' '}
                  <a
                    href="https://api-console.zoho.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-accent underline underline-offset-4"
                  >
                    Zoho API Console
                  </a>{' '}
                  创建 Server-based Application，取得 Client ID 和 Client
                  Secret，稍后填入「添加邮箱」表单。应用的回调地址须与服务端配置一致，默认本地开发地址为：
                </p>}
                <div className="flex items-start gap-2 rounded-lg bg-surface-muted p-3">
                  <code className="min-w-0 flex-1 break-all text-[11px] text-body">
                    {callbackUrl}
                  </code>
                  <button
                    type="button"
                    className="icon-button -mt-1 -mr-1 size-7"
                    onClick={copyCallback}
                    aria-label={copied ? '回调地址已复制' : '复制回调地址'}
                  >
                    {copied ? (
                      <Check className="size-3.5 text-accent" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                </div>
                {copied && (
                  <p role="status" className="text-accent">
                    回调地址已复制。
                  </p>
                )}
                {copyError && (
                  <p role="status" className="text-warning-ink">
                    浏览器未允许复制，请手动选择上方地址。
                  </p>
                )}
                <p>
                  在服务端环境文件中配置以下项目，再重新启动服务。桌面版使用控制台所显示的
                  zohome.env，源码开发使用 ZohoService/.env：
                </p>
                <dl className="divide-y divide-line-soft rounded-lg border border-line-soft px-3">
                  {[
                    ['APP_MODE', '设为 live，启用真实邮箱模式'],
                    [
                      'APP_PASSWORD',
                      '设置至少 12 个字符的 ZoHome 系统访问密码',
                    ],
                    [
                      'TOKEN_ENCRYPTION_KEY',
                      '设置 64 位十六进制随机密钥，用于加密保存授权',
                    ],
                    [
                      setupProvider === 'outlook' ? 'OUTLOOK_REDIRECT_URI' : 'ZOHO_REDIRECT_URI',
                      setupProvider === 'outlook'
                        ? '与 Microsoft 应用 Web 平台登记的回调地址完全一致'
                        : '与 Zoho 控制台登记的回调地址完全一致',
                    ],
                  ].map(([name, meaning]) => (
                    <div
                      key={name}
                      className="grid gap-1 py-2.5 md:grid-cols-[190px_minmax(0,1fr)]"
                    >
                      <dt className="break-all font-mono text-[11px] text-body">
                        {name}
                      </dt>
                      <dd>{meaning}</dd>
                    </div>
                  ))}
                </dl>
                <p>
                  新绑定不需要在服务端环境变量中设置 Client ID 或 Client
                  Secret，它们由绑定表单按邮箱提交。待授权记录中的 Client Secret
                  会加密保存，记录在 10 分钟后过期；授权成功后，Client Secret 和
                  Refresh Token 加密存入数据库。具体启动命令请参阅项目 README。
                </p>
                <a
                  href={setupProvider === 'outlook'
                    ? 'https://learn.microsoft.com/graph/auth-v2-user'
                    : 'https://www.zoho.com/mail/help/api/using-oauth-2.html'}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-accent"
                >
                  查看 {setupProvider === 'outlook' ? 'Microsoft' : 'Zoho'} 官方授权文档{' '}
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </div>
            </details>
          </StepSection>

          <StepSection
            id="organize"
            number="02"
            icon={FolderOpen}
            title="给每个账号安排好位置"
            description="账号多了以后，用搜索和分组快速找到需要处理的邮箱。"
          >
            <ol className="space-y-3">
              <Instruction number={1}>
                在「邮箱账号」中搜索邮箱地址或账号名称，快速缩小查找范围。
              </Instruction>
              <Instruction number={2}>
                为账号设置容易辨认的名称和分组，例如「客户服务」「日常工作」。
              </Instruction>
              <Instruction number={3}>
                如果提示需要重新授权，点击对应账号的重新授权入口，会复用已保存的应用配置，无需再次填写。
              </Instruction>
              <Instruction number={4}>
                如需替换 Client ID 或 Client
                Secret，选择「更换应用配置」。新授权成功且邮箱地址匹配后才会更新，原有连接在此之前会保留。
              </Instruction>
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line-soft p-4">
                <Search
                  className="mb-2.5 size-4 text-accent"
                  aria-hidden="true"
                />
                <p className="text-xs font-medium text-ink">先搜索，再操作</p>
                <p className="mt-1.5 text-xs leading-6 text-muted">
                  给账号取清晰的名称，发件和切换时更容易确认。
                </p>
              </div>
              <div className="rounded-xl border border-line-soft p-4">
                <ShieldCheck
                  className="mb-2.5 size-4 text-accent"
                  aria-hidden="true"
                />
                <p className="text-xs font-medium text-ink">移除账号前确认</p>
                <p className="mt-1.5 text-xs leading-6 text-muted">
                  从 ZoHome 移除连接会清理本地授权和该邮箱的返利网记录，不会注销
                  邮箱账号。
                </p>
              </div>
            </div>
          </StepSection>

          <StepSection
            id="read"
            number="03"
            icon={Inbox}
            title="收件箱、通知和其他文件夹，一起照看"
            description="从左侧的分组与邮箱树中找到账号，选中后加载它的邮件。"
          >
            <ol className="space-y-3">
              <Instruction number={1}>
                进入「邮件工作台」，左侧一级是账号分组，展开后显示二级邮箱。点击一个邮箱，即可加载该账号的邮件。
              </Instruction>
              <Instruction number={2}>
                账号较多时，用树上方的搜索框模糊搜索分组、账号名称或邮箱地址。命中分组会显示该组全部邮箱，命中账号名称或地址则显示匹配邮箱及其分组。
              </Instruction>
              <Instruction number={3}>
                选中邮箱后切换文件夹，点击邮件查看正文。Zoho 会显示通知、订阅及自定义文件夹，标签较多时可左右滚动；Outlook 显示收件箱、垃圾邮件和已发送。
              </Instruction>
              <Instruction number={4}>
                需要查看最新邮件时，刷新当前文件夹；邮件较多时，继续翻页查看。搜索账号和展开分组不会同时加载所有邮箱的邮件。
              </Instruction>
            </ol>
            <div className="flex items-start gap-3 rounded-xl border border-warning-line bg-warning-surface/70 p-4">
              <RefreshCw
                className="mt-0.5 size-4 shrink-0 text-warning-ink"
                aria-hidden="true"
              />
              <p className="text-xs leading-6 text-warning-ink/80">
                读取结果可能来自缓存。刷新针对当前邮箱执行；如果遇到邮箱服务的
                频率限制，请稍后再试。垃圾邮件也值得定期检查，避免漏掉被误判的重要来信。
              </p>
            </div>
          </StepSection>

          <StepSection
            id="send"
            number="04"
            icon={Send}
            title="从正确的邮箱，发出下一封邮件"
            description="写信前先确认发件账号，发送前再核对一次收件人和内容。"
          >
            <ol className="space-y-3">
              <Instruction number={1}>
                点击「写邮件」，明确选择这封邮件使用的发件账号。
              </Instruction>
              <Instruction number={2}>
                填写收件人、主题和正文，检查邮箱地址与内容。
              </Instruction>
              <Instruction number={3}>
                确认后发送，并查看页面返回的结果。发件失败时，按错误提示处理后再决定是否重试。
              </Instruction>
            </ol>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-surface-muted p-4">
              {['发件账号正确', '收件地址无误', '主题和正文完整'].map(
                (item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1.5 text-xs text-body"
                  >
                    <Check
                      className="size-3.5 text-accent"
                      aria-hidden="true"
                    />{' '}
                    {item}
                  </span>
                ),
              )}
            </div>
            <p className="text-xs leading-6 text-muted">
              演示模式中的发送仅为模拟。真实模式使用对应账号发送邮件，仍受邮箱服务
              的账号额度和服务规则约束。
            </p>
          </StepSection>

          <StepSection
            id="rebates"
            number="05"
            icon={ChartNoAxesCombined}
            title="按邮箱记录返利网与收益"
            description="一条记录关联一个邮箱，可在同一个邮箱下记录多个返利网和 offer。"
          >
            <ol className="space-y-3">
              <Instruction number={1}>
                进入「返利网」，点击「新增记录」，搜索并选择关联邮箱，填写返利网名称、域名、创建时间和
                Offer。名称、域名和 Offer
                可搜索并选择已有值，也可手动输入新值；保存后下次可直接复用。
              </Instruction>
              <Instruction number={2}>
                录入总收益和总成本，填写结款周期、IP，并标记是否结款、是否封户。金额请统一使用同一币种。
              </Instruction>
              <Instruction number={3}>
                保存后可继续编辑或删除。通过邮箱、关键词、结款和封户状态筛选记录，顶部三个图会同步展示匹配邮箱的收益、成本与转化对比。总览中已封户记录只计成本、不计收益；收益图使用浅红色表示未收款，绿色表示已收款，同一邮箱可分段显示两种状态。
              </Instruction>
            </ol>
            <div className="notice">
              转化按「总成本:总收益」自动约分，并补充三位小数的近似值，例如图表显示
              4:41 ≈ 1:10.250，表格显示 4:41 ≈ 10.250。成本为零时近似值显示
              —。整体转化根据汇总金额计算，统计包含筛选后的全部记录，不受明细分页影响；明细保留原始录入金额。
            </div>
          </StepSection>

          <section id="faq" className="panel scroll-mt-24 p-6 md:p-7">
            <div className="mb-2 flex items-center gap-3">
              <span className="eyebrow">A LITTLE MORE HELP</span>
              <span className="h-px flex-1 bg-surface-hover" />
            </div>
            <h2 className="mt-3 text-lg font-semibold tracking-tight">
              还有一些你可能想知道的事
            </h2>
            <div className="mt-5 divide-y divide-line-soft">
              {questions.map((question) => (
                <details key={question.title} className="group py-1">
                  <summary className="flex cursor-pointer list-none items-center gap-4 py-4 text-xs leading-6 font-medium text-ink [&::-webkit-details-marker]:hidden">
                    {question.title}
                    <ChevronDown
                      className="ml-auto size-4 shrink-0 text-subtle transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="pr-6 pb-4 text-xs leading-7 text-muted">
                    {question.answer}
                  </p>
                </details>
              ))}
            </div>
          </section>
        </div>

        <aside aria-label="使用提示" className="space-y-5 xl:sticky xl:top-20">
          <div className="overflow-hidden rounded-2xl bg-brand-800 p-6 text-white">
            <div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-white/10 text-lime-soft">
              <Sparkles className="size-5" aria-hidden="true" />
            </div>
            <p className="text-[10px] font-medium tracking-[0.16em] text-brand-200 uppercase">
              A GOOD PLACE TO START
            </p>
            <h2 className="mt-3 text-lg leading-8 font-medium">
              先熟悉，再连接。
              <br />
              从一个邮箱开始。
            </h2>
            <p className="mt-3 text-xs leading-7 text-brand-200">
              先用少量真实账号验证授权、读信与发件，再逐步扩大接入范围。
            </p>
            <a
              href="#connect"
              className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-lime-soft"
            >
              查看连接步骤 <ArrowDown className="size-3.5" aria-hidden="true" />
            </a>
          </div>

          <div className="panel p-5">
            <h2 className="section-title">使用前的小检查</h2>
            <ul className="mt-4 space-y-4">
              {[
                '确认当前是演示模式还是真实模式',
                '确认选中的邮箱地址和连接状态',
                '发送前检查发件账号与收件人',
                '遇到频率限制时，等待后再刷新',
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2.5 text-xs leading-6 text-muted"
                >
                  <MailCheck
                    className="mt-1 size-3.5 shrink-0 text-brand-500"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <a
            href="https://www.zoho.com/mail/help/api/"
            target="_blank"
            rel="noreferrer"
            className="group flex items-start gap-3 rounded-xl border border-line/80 p-4 transition-colors hover:border-accent-line hover:bg-surface"
          >
            <BookOpen
              className="mt-0.5 size-4 shrink-0 text-subtle"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-body">
                Zoho Mail 官方文档
              </p>
              <p className="mt-1 text-[11px] leading-5 text-subtle">
                了解接口能力与授权说明
              </p>
            </div>
            <ArrowUpRight
              className="size-3.5 shrink-0 text-subtle transition-colors group-hover:text-accent"
              aria-hidden="true"
            />
          </a>
        </aside>
      </div>
    </div>
  );
}
