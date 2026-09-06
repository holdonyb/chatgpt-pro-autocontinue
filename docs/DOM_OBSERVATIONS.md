# DOM observations

状态：已收到 composer 的真实、脱敏 DOM；消息与分支 DOM 仍待观察。此文件只记录专用测试对话中的最小证据。

截至 2026-09-06，本会话没有可用的 Chrome 页面控制工具，也没有向用户的正式研究对话发送测试消息。用户提供的真实页面截图和 composer DOM 确认：

- 当前 composer 底部的 Pro 模式可见文本为 `6 Pro`，并带下拉箭头。
- 生成中的页面显示绿色圆形停止控件，内部是白色方块。
- 回答区域显示复制、评论、分享、更多操作控件。
- composer 同时包含隐藏的 `textarea[name="prompt-textarea"].wcDTda_fallbackTextarea`（`display: none`）和真正的 `div#prompt-textarea.ProseMirror[contenteditable="true"][role="textbox"]`。
- 空编辑器包含带 `data-empty-paragraph="true"` 的占位 `<p>`；手动输入后内容为普通 `<p>` 文本。
- 输入后发送按钮为 `button#composer-submit-button[type="submit"][data-testid="send-button"][aria-label="发送提示词"]`。
- 空输入时同一位置显示 `button[aria-label="启动语音功能"]`。

代码现在显式忽略隐藏 fallback textarea，优先选择真实 ProseMirror，并精确识别发送按钮。以下内容仍待真实 DOM 观察：

- 对话 URL 和项目内对话路径：未观察。
- 网页中区分实际 Pro 模式的稳定属性：未观察；仅确认可见文本。
- 稳定消息 ID、分支标志：未观察。
- 长推理、工具卡片、最终答案完成信号：未观察。
- 编辑器人工输入后的 DOM 和发送按钮属性：已观察；v0.1.7 已在真实 Pro 页面完成一次扩展注入和实际发送。新用户消息 ID 未及时被适配器识别，但发送后 composer 清空可作为独立接受证据。

代码中的选择器只是候选适配器。若候选选择器无法给出稳定的模式、消息 ID、完成证据，适配器必须返回 `UNKNOWN`，协调器不得发送。真实观察时不要保存完整研究文本、cookie、token、截图或整页 HTML。
