# MAP/web

## web/
- eslint.config.js [12L]
- index.html [16L]
- package.json [8L]
- postcss.config.js [2L]
- tailwind.config.js [9L]
- tsconfig.json [19L]
- vite.config.ts [36L]

## web/src/
- App.tsx [91L] Páginas pesadas em chunks separados — só baixam quando abertas. — RouteFallback(), PrivateRoute(), App()
- main.tsx [11L]
- styles.css [334L] Design tokens
- vite-env.d.ts [3L] <reference types="vite/client" />

## web/src/api/
- client.ts [99L] — getToken(), setToken(), clearToken(), sanitizeErrorMessage(), api(), filenameFromContentDisposition(), downloadApiFile()

## web/src/components/
- Layout.tsx [206L] — isActive(), Layout()
- ui.tsx [435L] Primitivos de UI do painel. — Icon(), Card(), CardHeader(), buttonClass(), Button(), LinkButton(), Badge(), SearchInput(), PageHeader(), Skeleton(), EmptyState(), ErrorNotice()

## web/src/components/ai/
- AiAssistantPanel.tsx [1347L] — AiAssistantPanel(), StatCard(), TagSelectModal()
- AiCopyButton.tsx [207L] Ícone que abre o pedido de texto para a IA. */ — AiCopyButton(), AiCopyDialog(), Spark(), readFile()
- AiProviderModelPicker.tsx [103L] — AiProviderModelPicker()
- aiCatalog.ts [83L] Catálogo visível no Deskcomm. Só entra em modelChat quem tem apiId da OpenAI. */ — modelLabel(), priceTitle()

## web/src/components/broadcast/
- BroadcastMediaField.tsx [167L] Arquivo do disparo: envio do computador ou item da biblioteca. */ — BroadcastMediaField(), labelOf(), readFile()

## web/src/components/email/
- EmailBlockEditor.tsx [625L] — VarChips(), EmailImageLibrary(), BlockEditor(), blockTitle(), cloneBlock(), EmailBlockEditor()
- EmailBuilder.tsx [201L] — ToolbarButton(), EmailBuilder()
- EmailEditorModal.tsx [138L] — EmailEditorModal()
- EmailSettingsPanel.tsx [284L] — EmailSettingsPanel()
- emailBlocks.ts [250L] — newBlockId(), createBlock(), alignStyle(), paragraphHtmlToText(), textToParagraphHtml(), escapeForHtml(), blocksToHtml(), parseButtonFromParagraph(), htmlToBlocks(), reorderBlocks(), htmlPreviewText()

## web/src/components/flow/
- FlowNode.tsx [472L] Alturas fixas — handles calculados em px para alinhar com o nome da oferta. */ — branchCodesPreview(), handleTopForRow(), OfferOutputRow(), RoundRobinOutputRow(), FlowNodeComponent()
- FlowNodeProperties.tsx [1641L] Texto bruto do input — permite digitar vírgulas entre códigos. */ — offerCodesInputValue(), parseOfferCodes(), messageParts(), FlowNodeProperties()
- FlowZoomToolbar.tsx [59L] — FlowZoomToolbar()
- NodeContextMenu.tsx [45L] — NodeContextMenu()
- TemplateVariablesHelp.tsx [52L] — TemplateVariablesHelp()
- flowTemplateVars.ts [31L] Variáveis Mustache disponíveis nos blocos de mensagem (conforme executor / Hotma — mustacheSnippet()
- nodeMeta.ts [213L] — paletteDragType(), hotmartWebhookUrl(), customWebhookUrl(), buildWaMeLink(), defaultNodeData()

## web/src/components/inbox/
- ChatTools.tsx [147L] — ChatTools()
- ContactProfilePanel.tsx [588L] — formatPhoneDisplay(), ContactProfilePanel()
- ForwardMessageModal.tsx [323L] — isBase64Blob(), mediaUrlFromMessage(), captionFromMessage(), messageToForwardPayload(), chatLabel(), ForwardMessageModal()
- InboxComposer.tsx [561L] — readFileAsDataUrl(), blobToDataUrl(), uploadDataUrl(), pickAudioMimeType(), IconPlus(), IconSmile(), IconMic(), IconSpark(), IconSend(), IconTrash(), InboxComposer()
- LinkifyText.tsx [67L] — normalizeHref(), splitTrailingPunctuation()
- MicWaveform.tsx [37L] Barras verticais estilo WhatsApp Web (ondulações do microfone). */
- TemplateButtons.tsx [181L] Mensagens de template / botão são gravadas como texto + linhas "▸ Rótulo → url". — parseTemplateBody(), hasTemplateButtons(), isOpaqueInteractiveBody(), normalizeHref()
- WaAudioPlayer.tsx [212L] — formatDuration(), formatSpeed()
- WaMediaViewer.tsx [101L]
- WhatsAppAvatar.tsx [96L] — initials()
- WhatsAppInbox.tsx [2131L] — isRadarChat(), chatKindLabel(), chatMatchesTab(), sanitizeChatName(), canonicalBrazilPhone(), formatPhoneDisplay(), sessionInitials(), IconRefresh(), IconSettings(), IconPlay(), usePageVisible(), isBase64Blob(), +20
- useMicWaveform.ts [70L] Níveis de amplitude do microfone (0–1) atualizados via AnalyserNode + rAF. */ — emptyLevels(), useMicWaveform()

## web/src/components/message/
- MessageComposer.tsx [208L] Uma mensagem só: texto, imagem e vídeo no mesmo bloco, com a prévia de como sai. — newId(), emptyTextPart(), MessageComposer(), readFile()

## web/src/components/wpp/
- WppConnectPanel.tsx [580L] — WppConnectPanel()
- WppInstancesManager.tsx [499L] — WppInstancesManager()

## web/src/pages/
- Broadcast.tsx [190L] — Broadcast()
- Contacts.tsx [319L] — phoneLabel(), Contacts()
- Dashboard.tsx [574L] — formatEventTime(), formatDay(), BarChart(), ChartSkeleton(), DistributionList(), Dashboard()
- EmailAnalytics.tsx [137L] — when(), EmailAnalytics()
- FlowEditor.tsx [801L] — summaryFor(), toReactFlowNodes(), toReactFlowEdges(), cloneNodeConfig(), FlowEditor()
- FlowRuns.tsx [270L] — statusBadge(), formatDateTime(), FlowRuns()
- FlowsList.tsx [254L] — webhookShortcutForFlow(), formatUpdatedAt(), FlowsList()
- Funnel.tsx [334L] — Funnel()
- Login.tsx [117L] — Login()
- MediaLibrary.tsx [442L] — formatBytes(), formatDate(), MediaLibrary()
- Settings.tsx [98L] — Settings()
- WhatsApp.tsx [6L] — WhatsApp()

## web/src/types/
- quickReply.ts [21L] — sortQuickReplies()
