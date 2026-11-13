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
  Building2,
  Fingerprint,
  Settings,
  KeyRound,
  MailCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

const chapters = [
  { id: 'connect', label: '邮箱绑定' },
  { id: 'browsers', label: '指纹浏览器' },
  { id: 'rebates', label: '返利网' },
  { id: 'workspaces', label: '工作区' },
  { id: 'settings', label: '系统设置' },
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
          <p className="eyebrow">分类 {number}</p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <p className="mt-2 text-[15px] leading-7 text-muted">{description}</p>
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
    <li className="flex items-start gap-3 text-[15px] leading-7 text-body">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-hover text-[12px] font-semibold text-muted">
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
          <h1 className="page-heading mt-3">使用指南</h1>
          <p className="page-description">
            按页面了解邮箱绑定、指纹浏览器、返利网、工作区和系统设置的操作流程。
          </p>
        </div>
        <span className="badge-muted mt-1 gap-2 px-3 py-2">
          <Clock3 className="size-3.5" aria-hidden="true" />
          预计阅读 10 分钟
        </span>
      </div>

      <div className="mt-7 flex items-center gap-4 rounded-2xl border border-accent-line bg-accent-muted/70 p-5 md:px-6">
        <div className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-surface text-accent sm:flex">
          <BookOpen className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-accent">
            先选择工作区，再开始操作。
          </p>
          <p className="mt-1 text-[15px] leading-7 text-accent/80">
            推荐顺序：选择工作区 → 绑定邮箱 → 导入指纹浏览器 → 录入返利网并关联浏览器 → 配置 Google Ads 后刷新预算。
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
            <span className="text-[12px] text-subtle">0{index + 1}</span>
            {chapter.label}
          </a>
        ))}
      </nav>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-5">
          <StepSection id="connect" number="01" icon={Plus} title="邮箱绑定" description="在当前工作区绑定 Zoho 或 Outlook 邮箱，然后管理账号、阅读和发送邮件。">
            <div id="binding" className="scroll-mt-24 space-y-4">
              <h3 className="text-base font-semibold">添加邮箱与官方授权</h3>
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
              <p className="text-[15px] leading-7 text-muted">
                邮箱密码只在邮箱服务的
                官方页面输入。若浏览器中登录了其他邮箱，系统会拒绝不匹配的授权，并提示重新选择正确账号；不会把它绑定到你填写的地址。
              </p>
            </div>
            <details className="group rounded-xl border border-line">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium text-body [&::-webkit-details-marker]:hidden">
                <KeyRound className="size-4 text-subtle" aria-hidden="true" />
                首次使用：准备应用信息与服务端配置
                <ChevronDown
                  className="ml-auto size-4 shrink-0 text-subtle transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="space-y-4 border-t border-line-soft p-4 text-[15px] leading-7 text-muted">
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
                  <code className="min-w-0 flex-1 break-all text-[13px] text-body">
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
                  平台管理员在服务端环境文件中配置以下项目，再重新启动服务。桌面版使用控制台所显示的
                  zohome.env，源码开发使用 ZohoService/.env：
                </p>
                <dl className="divide-y divide-line-soft rounded-lg border border-line-soft px-3">
                  {[
                    ['APP_MODE', '设为 live，启用真实邮箱模式'],
                    [
                      'APP_PASSWORD',
                      '首次初始化 admin 账号的密码，至少 12 个字符；日后在系统设置中修改账号密码',
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
                      <dt className="break-all font-mono text-[13px] text-body">
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
                  Refresh Token 加密存入发起授权的工作区。开始绑定前请确认顶部所选工作区，其他工作区不会自动获得该邮箱。具体启动命令请参阅项目 README。
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
            </div>
            <div id="organize" className="scroll-mt-24 space-y-4">
              <h3 className="text-base font-semibold">管理账号与重新授权</h3>
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
                <p className="text-sm font-medium text-ink">先搜索，再操作</p>
                <p className="mt-1.5 text-[15px] leading-7 text-muted">
                  给账号取清晰的名称，发件和切换时更容易确认。
                </p>
              </div>
              <div className="rounded-xl border border-line-soft p-4">
                <ShieldCheck
                  className="mb-2.5 size-4 text-accent"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-ink">移除账号前确认</p>
                <p className="mt-1.5 text-[15px] leading-7 text-muted">
                  从 ZoHome 移除连接会清理本地授权和该邮箱的返利网记录，不会注销
                  邮箱账号。
                </p>
              </div>
            </div>
            </div>
            <div id="read" className="scroll-mt-24 space-y-4">
              <h3 className="text-base font-semibold">邮件工作台：查看邮件</h3>
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
              <p className="text-[15px] leading-7 text-warning-ink/80">
                读取结果可能来自缓存。刷新针对当前邮箱执行；如果遇到邮箱服务的
                频率限制，请稍后再试。垃圾邮件也值得定期检查，避免漏掉被误判的重要来信。
              </p>
            </div>
            </div>
            <div id="send" className="scroll-mt-24 space-y-4">
              <h3 className="text-base font-semibold">写邮件：选择发件账号</h3>
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
                    className="inline-flex items-center gap-1.5 text-sm text-body"
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
            <p className="text-[15px] leading-7 text-muted">
              演示模式中的发送仅为模拟。真实模式使用对应账号发送邮件，仍受邮箱服务
              的账号额度和服务规则约束。
            </p>
            </div>
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
                  <summary className="flex cursor-pointer list-none items-center gap-4 py-4 text-[15px] leading-7 font-medium text-ink [&::-webkit-details-marker]:hidden">
                    {question.title}
                    <ChevronDown
                      className="ml-auto size-4 shrink-0 text-subtle transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="pr-6 pb-4 text-[15px] leading-7 text-muted">
                    {question.answer}
                  </p>
                </details>
              ))}
            </div>
          </section>
          </StepSection>

          <StepSection id="browsers" number="02" icon={Fingerprint} title="指纹浏览器" description="集中记录浏览器窗口、代理与邮箱，并通过返利网记录查看注册分布。">
            <h3 className="text-base font-semibold">从比特浏览器直接导入</h3>
            <ol className="space-y-3">
              <Instruction number={1}>在比特浏览器中导出窗口信息表格，可直接用该表格导入，无需重新制作模板。请选择 .xlsx 格式，文件不超过 5 MB，保留「序号」「ID」「窗口名称」列；「代理信息」可留空。</Instruction>
              <Instruction number={2}>进入「指纹浏览器」，点击「导入 Excel」选择文件。系统先读取预览，此时不会修改现有数据；核对数量及序号、ID、窗口名称和代理信息。</Instruction>
              <Instruction number={3}>确认无误后，勾选「我已核对预览，确认全部替换现有指纹浏览器信息」，再点击「确认导入并全部替换」。预览只显示前 50 行，确认后会导入全部有效行。</Instruction>
            </ol>
            <div className="rounded-xl border border-warning-line bg-warning-surface p-4 text-[15px] leading-7 text-warning-ink"><strong>导入是全部替换。</strong>表格中没有的浏览器会被删除，相关返利网记录保留并解除浏览器关联；相同 ID 的浏览器保留关联。请导出需要保留的完整窗口列表，并核对重复 ID、重复序号等报错后再导入。</div>
            <h3 className="text-base font-semibold">新增、编辑、查询和删除</h3>
            <ol className="space-y-3">
              <Instruction number={1}>点击「新增指纹浏览器」，填写必填的序号、ID、窗口名称，按需填写代理信息，并勾选关联邮箱，点击「保存信息」。邮箱选项与返利网页面共用，包含「未知」邮箱。</Instruction>
              <Instruction number={2}>使用搜索框按序号、ID、窗口名称、代理或邮箱查找，翻页查看列表；点击行内编辑按钮修改信息。删除浏览器前核对窗口名称和序号，确认后相关返利网记录仍保留，但浏览器关联会解除。</Instruction>
              <Instruction number={3}>在上方「浏览器与返利网热力图」搜索窗口、返利网、邮箱或 Offer。悬停色块查看详情，点击可固定详情并复制。绿色代表正常，红色代表已封号，虚线代表未关联；同一邮箱的多个 Offer 分别展示。热力图有独立搜索，不受下方列表搜索和分页影响。</Instruction>
            </ol>
            <figure className="rounded-xl border border-accent-line bg-accent-muted/50 p-4">
              <figcaption className="mb-3 text-base font-semibold text-accent">指纹浏览器与返利网如何关联</figcaption>
              <div className="grid items-center gap-3 text-center text-sm sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
                <div className="rounded-lg border border-line bg-surface p-3">指纹浏览器窗口<br /><span className="text-subtle">同一窗口的 ID 与序号</span></div>
                <span className="text-accent" aria-hidden="true">←</span>
                <div className="rounded-lg border border-line bg-surface p-3">返利网记录<br /><span className="text-subtle">选择一个浏览器和一个邮箱</span></div>
                <span className="text-accent" aria-hidden="true">→</span>
                <div className="rounded-lg border border-line bg-surface p-3">邮箱<br /><span className="text-subtle">已绑定或「未知」邮箱</span></div>
              </div>
              <p className="mt-3 text-[15px] leading-7 text-body">例如：在邮箱 A 的返利网记录里选择窗口 001，该记录就会出现在窗口 001 对应返利网的热力图中，邮箱 A 也会显示在该浏览器的关联邮箱中。一个窗口可关联多个邮箱和多条返利网记录。</p>
              <p className="mt-2 text-[15px] leading-7 text-muted">在浏览器编辑框中单独勾选邮箱，只建立窗口与邮箱的关联，不会自动新增返利网记录。要展示网站、Offer、密码和封户状态，请到「返利网」新增或编辑记录并选择浏览器。</p>
            </figure>
          </StepSection>

          <StepSection id="rebates" number="03" icon={ChartNoAxesCombined} title="返利网" description="每条记录对应一个邮箱、返利网与 Offer，可选关联一个指纹浏览器。">
            <ol className="space-y-3">
              <Instruction number={1}>进入「返利网」，点击「新增记录」。搜索并选择已绑定邮箱，也可直接输入新邮箱地址；未绑定的地址自动标为「未知」，可用于记账，无需先授权邮箱。</Instruction>
              <Instruction number={2}>填写返利网名称、域名、创建时间、Offer 和可选的登录密码。名称、域名和 Offer 可从「选择已用」中搜索选择，也可输入新值。密码支持显示和隐藏；编辑时清空密码再保存可删除原密码。</Instruction>
              <Instruction number={3}>在「关联指纹浏览器」搜索并选择 ID 或序号，另一项会自动对应同一窗口，不能手动填写。找不到时先到「指纹浏览器」新增或导入；也可留空。保存后，明细显示窗口 ID 与序号，浏览器页展示对应邮箱和返利网热力图。</Instruction>
              <Instruction number={4}>填写总收益、总成本、结款周期和 IP，标记是否结款、是否封户后保存。成本单位为 USD，收益也请使用美元。同一邮箱可以保存多个返利网和多个 Offer。</Instruction>
              <Instruction number={5}>按邮箱、关键词、结款及封户状态筛选，左右滚动明细表查看全部列，翻页或点击编辑、删除。删除记录也会将其收益和成本移出统计；如提示浏览器关联已失效，请重新选择或清空关联后保存。</Instruction>
            </ol>
            <h3 className="text-base font-semibold">查看收益、成本与转化</h3>
            <p className="text-[15px] leading-7 text-muted">顶部图表统计筛选后的全部记录，不受明细分页影响。已封户记录只计成本、不计收益；收益图浅红色表示未收款，绿色表示已收款，明细保留原始录入金额。转化按「成本:收益」约分，近似倍数为收益 ÷ 成本，成本为零时显示 —；整体转化按汇总金额计算。</p>
            <h3 className="text-base font-semibold">从 Google Ads 刷新预算</h3>
            <ol className="space-y-3">
              <Instruction number={1}>先在「系统设置 → 工作区设置」保存 Google Ads 经理号、API 版本和服务账号 JSON，并确认服务账号有目标 Ads 账号的访问权限。将返利网记录中的 Offer 名称与 Google Ads 广告系列名称保持一致。</Instruction>
              <Instruction number={2}>点击「刷新预算」，系统汇总同名广告系列的累计实际消费（USD），按关联邮箱平均分配；同一邮箱存在多条同名 Offer 记录时，再均分到记录。</Instruction>
              <Instruction number={3}>查看更新数量和未更新原因，按提示修正配置或 Offer 名称。未更新的 Offer 保留原成本。</Instruction>
            </ol>
            <div className="rounded-xl border border-warning-line bg-warning-surface p-4 text-[15px] leading-7 text-warning-ink">「刷新预算」会覆盖并保存成本，处理当前工作区的全部 Offer，不受当前筛选或分页影响。操作前请核对 Offer 名称与现有成本。</div>
          </StepSection>

          <StepSection id="workspaces" number="04" icon={Building2} title="工作区" description="每个工作区独立保存邮箱、指纹浏览器、返利网记录和连接配置。">
            <ol className="space-y-3">
              <Instruction number={1}>用页面顶部的工作区选择框切换，操作前确认当前名称。绑定邮箱、导入浏览器和保存返利网记录都会作用于当前工作区。</Instruction>
              <Instruction number={2}>进入「工作区管理」，在「新建工作区」填写名称，点击「创建并进入」。新工作区从空白开始，你成为所有者，原工作区的数据和凭据不会自动复制。</Instruction>
              <Instruction number={3}>所有者可在「当前工作区」修改名称并点击「保存名称」。在「工作区成员」输入已有平台账号的用户名，选择「成员」或「所有者」，点击「添加成员」。</Instruction>
              <Instruction number={4}>在成员列表中修改角色或移除成员。成员可使用工作区业务功能，所有者还可维护名称、成员和工作区设置。平台管理员有管理权限，可访问所有工作区。</Instruction>
              <Instruction number={5}>需要新登录账号时，由平台管理员在「创建平台账号」填写用户名与至少 12 位的初始密码，点击「创建账号」，再将该账号添加为目标工作区成员。平台账号与绑定的邮箱账号是不同用途。</Instruction>
            </ol>
            <p className="text-[15px] leading-7 text-muted">备份与迁移时保存整个数据目录、对应配置及原 TOKEN_ENCRYPTION_KEY。工作区设置和 Google Ads JSON 加密保存在平台目录库中，只复制某个工作区的业务数据库不能完成完整恢复。</p>
          </StepSection>

          <StepSection id="settings" number="05" icon={Settings} title="系统设置" description="区分当前工作区的连接配置、管理员的平台配置和个人登录密码。">
            <h3 className="text-base font-semibold">工作区设置</h3>
            <ol className="space-y-3">
              <Instruction number={1}>先确认顶部工作区，再进入「系统设置」。普通成员可查看，工作区所有者可修改；平台管理员可切换「工作区设置」与「平台设置」。</Instruction>
              <Instruction number={2}>按需修改 Zoho 请求间隔（至少 2100 毫秒）、Microsoft 账户类型或租户、Google Ads 经理号、API 版本及服务账号 JSON。旧版 Zoho 应用编号和密钥用于兼容旧授权，新邮箱的 Client ID 和 Client Secret 在绑定时填写。</Instruction>
              <Instruction number={3}>点击「保存设置」，当前工作区后续操作即使用新配置，无需重启服务。「撤销修改」放弃未保存内容，「重新读取」重新加载已保存配置；如提示设置已被修改，重新读取并核对后再保存。</Instruction>
            </ol>
            <div className="rounded-xl border border-accent-line bg-accent-muted/50 p-4 text-[15px] leading-7 text-body">
              <p><strong>Google Ads 服务账号 JSON 就是脚本的 credentials.json。</strong></p>
              <p className="mt-2">打开脚本使用的 credentials.json，将完整 JSON 内容粘贴到「Google Ads 服务账号 JSON」（ADS_CREDENTIALS_JSON）中，填写的是文件内容，不是文件名或路径。经理号填写 10 位数字，API 版本按页面提供的版本及实际可用版本填写。</p>
              <p className="mt-2">JSON 按工作区独立加密保存，不会为每个工作区生成 credentials.json 文件。保存后不回显原值；密码、密钥和凭证 JSON 留空均保留原值。旧版外部 credentials.json 若已导入默认工作区，之后替换该文件不会覆盖工作区已保存的 JSON，应在此重新粘贴保存。</p>
            </div>
            <h3 className="text-base font-semibold">平台设置（平台管理员）</h3>
            <p className="text-[15px] leading-7 text-muted">点击「平台设置」查看运行模式、端口、回调地址等服务环境配置，按实际部署修改可编辑项后「保存设置」，再重启 ZoHome 生效。只读项不能在页面修改；TOKEN_ENCRYPTION_KEY 用于解密已有数据，恢复或迁移时必须保留原值。</p>
            <h3 className="text-base font-semibold">修改个人登录密码</h3>
            <ol className="space-y-3">
              <Instruction number={1}>在页面下方「账号密码」输入当前密码、新密码和确认密码；新密码至少 12 位，两次输入保持一致。</Instruction>
              <Instruction number={2}>点击「修改密码并重新登录」。所有设备上的登录会话都会失效，使用新密码重新登录；修改的是平台登录密码。</Instruction>
            </ol>
          </StepSection>
        </div>

        <aside aria-label="使用提示" className="space-y-5 xl:sticky xl:top-20">
          <div className="overflow-hidden rounded-2xl bg-brand-800 p-6 text-white">
            <div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-white/10 text-lime-soft">
              <Sparkles className="size-5" aria-hidden="true" />
            </div>
            <p className="text-[12px] font-medium tracking-[0.16em] text-brand-200 uppercase">
              A GOOD PLACE TO START
            </p>
            <h2 className="mt-3 text-lg leading-8 font-medium">
              先熟悉，再连接。
              <br />
              从一个邮箱开始。
            </h2>
            <p className="mt-3 text-[15px] leading-7 text-brand-200">
              先用少量真实账号验证授权、读信与发件，再逐步扩大接入范围。
            </p>
            <a
              href="#connect"
              className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-lime-soft"
            >
              查看连接步骤 <ArrowDown className="size-3.5" aria-hidden="true" />
            </a>
          </div>

          <div className="panel p-5">
            <h2 className="section-title">使用前的小检查</h2>
            <ul className="mt-4 space-y-4">
              {[
                '确认顶部选中的工作区和运行模式',
                '确认选中的邮箱地址和连接状态',
                '发送前检查发件账号与收件人',
                '导入前核对全部替换的范围',
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2.5 text-[15px] leading-7 text-muted"
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
              <p className="text-sm font-medium text-body">
                Zoho Mail 官方文档
              </p>
              <p className="mt-1 text-[13px] leading-5 text-subtle">
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
