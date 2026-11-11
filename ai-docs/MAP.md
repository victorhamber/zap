# MAP — zap-review · 2026-11-10 · 207 arquivos · 43275 linhas
> Gerado por ai-docs/tools/map_repo.py — NÃO editar. Use isto em vez de ler o código inteiro: ache o arquivo/símbolo aqui e abra só o trecho.
Stack: node
Entradas: npm scripts: dev, dev:api, dev:worker, dev:web, build, build:api, build:web, start; api/src/index.ts; api/src/services/whatsapp/index.ts

## (raiz)/
- .dockerignore [24L] .tsbuildinfo
- .env.example [49L] Redis (BullMQ — agendamentos)
- AGENTS.md [42L] Zap — guia para IA
- Dockerfile [32L]
- Dockerfile.worker [33L]
- README.md [45L] Zap — inbox, fluxos e WhatsApp (WAHA)
- easypanel.md [102L] Deploy no EasyPanel (GitHub)
- eslint.config.js [28L] typebot/ é uma cópia de terceiros (582 MB) — não é código deste projeto
- package-lock.json [7842L]
- package.json [77L]
- replit.md [50L] trajettu-zap

## api/
- tsconfig.json [17L]

## api/src/
- bootstrap.ts [89L] — bootstrapDatabase()
- env.ts [117L] URL interna do Zap na rede Docker. O WAHA chama o webhook por aqui. Ex: http://z — defaultWhatsAppSession()
- index.ts [138L]
- prisma.ts [6L]
- queue.ts [177L] — getRedisConnection(), getFlowQueue(), sanitizeQueueJobId(), enqueueFlowJob(), getFlowStartQueue(), enqueueFlowRunStart(), getAiQueue(), aiReplyJobId(), enqueueAiLearnJob(), enqueueAiReplyJob(), cancelAiReplyJob(), getAiQueueCounts()
- seed.ts [45L] — main()
- worker.ts [132L] — main()

## api/src/engine/
- executor.ts [1522L] — delayToMs(), render(), sleepMs(), isRetriableSendError(), sendWithRetries(), sendMediaWithRetries(), persistFlowOutboundMessage(), resolveFlowTriggerType(), resolveSendTarget(), resolveHotmartOfferCode(), resolveHotmartPurchaseId(), extractHotmartVariables(), +17
- graph.test.ts [32L]
- graph.ts [124L] — parseGraph(), findTriggerNode(), findFlowTriggerNode(), getFirstActionAfterTrigger(), getLinearNextNodeIds(), getNextNodeId(), getNextNodeIdByHandle(), getNode(), defaultHotmartGraph()

## api/src/middleware/
- auth.ts [54L] — signToken(), verifyToken(), assertTokenValid(), requireAuth()

## api/src/routes/
- ai.ts [226L] — aiRoutes()
- auth.ts [98L] Janela e teto de tentativas de login por IP. */ — loginThrottle(), registerFailedLogin(), authRoutes()
- crm.ts [56L] — crmRoutes()
- dashboard.ts [213L] — funnelSnapshot(), countRadar(), startOfToday(), daysAgo(), localDayKey(), last7DayKeys(), bucketByDay(), dashboardRoutes()
- flows.ts [299L] — flowRoutes()
- inbox.ts [743L] — sortQuickReplies(), normalizeQuickReply(), parseQuickReplies(), sanitizeQuickRepliesForSave(), preferMergedChatId(), mergeInboxChatRows(), dedupeInboxChatRows(), inboxRoutes()
- media.ts [47L] — mediaRoutes()
- runs.ts [31L] — runRoutes()
- settings.ts [349L] — settingsRoutes()
- webhooks.ts [626L] — triggerInboundFlows(), whatsappWebhookAuthorized(), rejectWebhook(), webhookRoutes()
- wpp.ts [372L] — buildKeepSessionNames(), listServerSessionNames(), wppRoutes()

## api/src/services/
- adminUser.ts [33L] Sincroniza admin do .env; ao mudar a senha, invalida JWTs emitidos antes. */ — syncAdminUserFromEnv()
- broadcastFlowTrigger.ts [100L] — normalizeContactPhone(), queueBroadcastRun(), dispatchBroadcastFlow()
- coldFollowUp.test.ts [74L]
- coldFollowUp.ts [121L] — parseFollowUpSteps(), nextFollowUp(), runColdFollowUps()
- contactAvatar.ts [27L] sem foto */ — getContactAvatarUrl()
- contactProfile.ts [109L] — inboxSession(), getContactProfile(), getContactSharedGroups()
- contactStage.test.ts [23L]
- contactStage.ts [97L] — isLostReason(), isFunnelStage(), nextStage(), setContactStage(), noteInbound(), notePurchase(), stageLabelForPhone()
- contacts.ts [258L] — toStoragePhone(), findContactByPhoneLoose(), getContactTagNames(), upsertContact(), listContactsWithTags(), normalizeContactEmail(), contactToJson(), isWeakContactName(), ensureContact(), ensureTagsByNames(), addContactTagsByNames(), removeContactTagsByNames()
- flowDispatch.ts [42L] Enfileira o início de um fluxo com cadência global humanizada (anti-spam). — queueFlowRunStart()
- flowRoundRobin.ts [46L] Próximo índice de ramo (0..branchCount-1) em round robin global por fluxo + nó. — getRedisClient(), reserveRoundRobinBranch()
- flowScheduler.ts [94L] Recupera execuções presas em delay/agendamento quando o worker BullMQ não proces — processDueScheduledJobs(), startFlowScheduler(), stopFlowScheduler()
- flowStagger.ts [85L] Intervalo aleatório entre min e max (segundos), com leve variação extra. */ — getRedisClient(), humanGapMs(), getGlobalDispatchStaggerConfig(), reserveStaggeredStartDelay()
- flowStartRecovery.ts [59L] Jobs aguardando além desse tempo são retomados pelo scheduler (worker offline).  — recoverOverdueFlowStarts()
- flowStartWorker.ts [35L] Processa a fila zap-flow-starts (inícios de fluxo com cadência). */ — startFlowStartWorker()
- flowVariables.test.ts [17L]
- flowVariables.ts [68L] E-mail válido para Mustache / Resend. */ — normalizeFlowEmail(), enrichFlowVariables(), persistContactFromFlowVariables()
- groupsFlowTrigger.ts [210L] — normalizeGroupId(), readTriggerGroupsData(), getTriggerGroupsFromFlow(), dispatchGroupsFlow(), countActiveGroupsRuns(), ensureGroupsFlowRunning(), groupsFlowHasScheduleNodes(), restartGroupsFlow()
- inbox.test.ts [166L] Cenário do bug: a Evolution marcou um contato direto como isGroup.
- inbox.ts [1335L] — readChatKey(), markChatReadLocally(), isChatReadLocally(), markInboxChatAsRead(), extractWaId(), isValidWaId(), chatIdToPhone(), isPhoneLikeText(), resolveChatId(), detectKind(), coerceDisplayText(), pickChatDisplayName(), +32
- inboxStore.ts [1592L] — isButtonPlaceholderBody(), isPrismaUniqueConflict(), digitsOnly(), chatIdVariants(), messageSyncJidCandidates(), chatIdVariantsResolved(), resolveAllChatIdsForContact(), preferPrimaryChatId(), canonicalizeChatId(), findPrimaryChatIdForPhone(), findPrimaryChatIdForContact(), getSessionName(), +45
- inboxSync.ts [56L] — syncRecentMessagesFromWpp()
- inboxTemplateRepair.ts [91L] Reprocessa mensagens antigas gravadas com o texto genérico de template/botão — maskMissingParameters(), repairTemplatePlaceholders()
- mediaConvert.ts [50L] WhatsApp PTT exige OGG/Opus — gravação do navegador vem em WebM. */ — convertWebmDataUrlToOgg(), persistInboundMedia()
- mediaLibrary.ts [275L] — getSessionName(), isSafeUploadFilename(), inferKind(), formatBytes(), listMediaLibrary(), clearQuickReplyMedia(), deleteMediaFile(), deleteMediaFiles(), deleteAllMediaFiles()
- mediaText.ts [31L] Detecta payload base64 que não deve aparecer como texto no chat. */ — isLikelyBase64Payload(), labelForMediaType(), captionFromText(), mimeFromMessageType()
- secretCrypto.ts [59L] Chave de 32 bytes: AI_ENCRYPTION_KEY (hex) ou derivada do JWT_SECRET já usado no — resolveEncryptionKey(), isEncryptionConfigured(), encryptSecret(), decryptSecret(), maskSecret()
- tagFlowTrigger.ts [190L] — matchTagTrigger(), queueTagFlow(), dispatchTagTriggerFlows(), dispatchTagFlowToContactsWithTag(), dispatchTagFlowToExistingContacts()
- uploads.ts [204L] — ensureUploadDir(), publicUploadUrl(), uploadUrlForWpp(), rewriteUploadUrlForWpp(), uploadFilenameFromUrl(), isPersistedUploadUrl(), toPublicMediaUrl(), readUploadFileBase64(), loadUploadMediaBase64(), fetchRemoteMediaBase64(), getUploadFileSize(), saveUploadFromData()
- waJid.ts [135L] Normalização de JIDs WhatsApp (Evolution / Baileys LID vs telefone). */ — isGenericSelfChatName(), digitsOnly(), isGroupLikeJid(), jidRank(), pickBestJid(), canonicalEvolutionChatId(), normalizeDirectJid(), isLikelyInternalLidDigits(), isLikelyInternalLidJid(), isValidWhatsAppPhoneDigits(), isOwnerPhoneDigits(), evolutionSendNumber()
- waLidMap.test.ts [61L]
- waLidMap.ts [267L] Mapeia @lid interno → telefone real (@s.whatsapp.net). */ — storeKey(), mapFile(), legacyMapFile(), jidCandidates(), pickPhoneJid(), pickLidJid(), applyWaJidMapping(), loadWaLidMap(), persistWaLidMap(), recordWaJidMappingSync(), recordWaJidMapping(), flushWaLidMap(), +6
- waha.ts [989L] Cliente HTTP do WAHA. Único motor de WhatsApp do Zap. — baseUrl(), apiKey(), reachableBaseUrl(), webhookUrl(), sessionConfig(), waha(), readBody(), formatWppError(), wahaJson(), normalizeSessionName(), sessionName(), getActiveWppSessionName(), +69
- wahaWebhook.ts [82L] — asRecord(), mediaType(), preview(), parseWahaMessage(), wahaSessionStatus()
- wppHumanize.ts [13L] Pequenos intervalos entre chamadas ao WPP para parecer uso humano (não elimina r — wppHumanDelay()
- wppMedia.ts [56L] — isInboundMediaType(), persistWahaUrl(), downloadMediaForStoredMessage(), downloadInboundMedia()
- wppReconnect.ts [156L] — shouldWatchReconnect(), needsQrScan(), attemptAutoReconnect(), startWppReconnectWatchdog(), tryRestoreSessionAfterDeploy()
- wppSend.ts [110L] Monta destino para APIs do WPP (número + flags isLid / isGroup). */ — digitsOnly(), resolveChatId(), buildWppSendTarget(), parseWppErrorMessage(), callSendMessage(), sendWppText(), extractWppMessageId(), sendWppApi()
- wppWebhook.ts [178L] Detecção de payload de mensagem no webhook WPPConnect (não confundir `event` com — touchWppWebhookReceived(), touchWppWebhookSaved(), touchWppWebhookSkipped(), getLastWppWebhookSavedAt(), getLastWppWebhookSkipReason(), getLastWppWebhookAt(), getLastWppWebhookEvent(), normalizeWppWebhookBody(), getWppWebhookEvent(), getWppMessageContentType(), isWppMessageWebhook()

## api/src/services/ai/
- chatState.test.ts [12L]
- chatState.ts [226L] — resolveCanonicalChatId(), findChatState(), getChatState(), setChatModeAuto(), setChatModeHuman(), resolveChatModeForInbound(), setPendingReply(), clearPendingReply(), saveConversationMemory(), saveConversationSummary(), expectedReplyJobId(), logAiEvent(), +1
- conversationMemory.ts [195L] "manual" (painel) e "webhook" (celular) são o atendente humano — rotular — speakerLabel(), formatTs(), formatHistoryLine(), dedupeHistoryRows(), fetchChatHistoryRows(), refreshConversationMemory(), buildChatContextForReply()
- crypto.ts [14L] — encryptApiKey(), decryptApiKey(), maskApiKey()
- enqueue.ts [336L] — modalityAllowed(), lockKey(), enqueueAiPipeline(), runEnqueueSerialized(), retryAiPipelineForContact(), drainNewerInboundForReply(), finishReplyScheduling(), isLikelyAiOrFlowEcho(), runEnqueue()
- historyLearn.ts [145L] — learnStaggerMs(), queueHistoryLearning()
- knowledgeImport.test.ts [38L]
- knowledgeImport.ts [200L] — parseCsvLine(), rowFromJsonObject(), parseKnowledgeImport(), importKnowledgeForSession()
- knowledgeRetrieval.test.ts [60L]
- knowledgeRetrieval.ts [275L] Peso do TIPO é só um desempate entre linhas que já casaram a pergunta — — normalizeText(), inboundTokens(), parseQaPair(), extractKnowledgeSearchText(), isKnownWrongCapitalMinimum(), buildOfficialFactsBlock(), scoreKnowledgeRow(), formatKnowledgeSnippet(), normalizePersonName(), redactLeadNamesFromKnowledge(), dedupeSnippets(), fetchSessionKnowledgeForReply()
- learnGate.test.ts [35L]
- learnGate.ts [46L] — knowledgeSourceMsgId(), modalityAllowedForLearn(), isHumanAnswerSource(), learnKindForHistoryMessage()
- learning.ts [179L] Antes eram 30 min: atendimento humano raramente responde tão rápido, então a — processLearnJob()
- mediaExtract.ts [262L] Máx. de frames enviados à Vision — só em temp, nunca persistidos no VPS. */ — ffmpegBin(), modalityFromType(), detectModality(), safeRmDir(), extractTextFromMessage(), extractVideoForAi(), resolveMediaUrl(), loadMediaBuffer(), resolveImageDataUrl(), extractInboundTextForReply()
- mediaResponses.test.ts [86L]
- mediaResponses.ts [117L] Sanitiza a lista recebida do painel para gravar (gera id, remove linhas vazias). — normalizeMediaResponsesForSave(), parseMediaResponses(), usableMediaResponses(), buildMediaResponsesBlock(), extractMediaResponseMarker(), stripMediaResponseMarker(), findMediaResponse()
- openaiClient.ts [292L] — OpenAiApiError, isOpenAiRateLimitError(), parseRetryAfterMs(), sleep(), openaiFetch(), openaiChat(), openaiVision(), openaiTranscribe(), extractKnowledge(), generateReply()
- purge.ts [34L] Remove memória e conhecimento da IA para um contato (todos os chatId variantes). — purgeAiForContact(), purgeAiForSession()
- replyContext.ts [223L] — resolveChatIdVariants(), resolveLeadStageForAi(), resolveLeadTagsForAi(), buildChatHistoryForAi(), fetchKnowledgeSnippetsForAi(), hasManualReplyAfterInbound(), hasAiReplyAfterInbound(), collectInboundBatchForReply(), getRecentAiReplies()
- replyService.ts [637L] — aiOutboundTimestamp(), sendAiChatText(), dispatchMediaResponse(), resolveClientNameForAi(), parseOfficialLinks(), processReplyJob(), simulateReply()
- rulesEngine.test.ts [159L]
- rulesEngine.ts [251L] — buildSystemPrompt(), validateReplyAgainstRules(), injectOfficialLinksHint(), normalizeReplyText(), stripDismissiveClosing(), normalizePersonName(), sanitizeReplyClientName(), isRepetitiveReply()
- settings.ts [279L] — getActiveSessionName(), parseOfficialLinks(), toDto(), loadSettingsRow(), getAiSettings(), resolveOpenAiApiKey(), saveAiSettings()
- stats.ts [108L] — getAiStats()
- tagGate.test.ts [19L]
- tagGate.ts [26L] Sem tags configuradas = todos elegíveis (filtro só quando a lista tem IDs). — contactHasLearnTags(), phoneFromChatId(), isGroupChatId()

## api/src/services/email/
- resend.ts [173L] — getSettingsRow(), getEmailSettingsDto(), saveEmailSettings(), loadResendClient(), formatFrom(), sendTransactionalEmail(), sendTestEmail(), wrapEmailHtml()

## api/src/services/whatsapp/
- index.ts [3L] Motor WhatsApp: WAHA. */
- metaTemplates.test.ts [81L]
- metaTemplates.ts [312L] Hidratação de templates oficiais Meta (Cloud API). — cacheKey(), languageRoot(), clearMetaTemplateCache(), fetchTemplateDefinition(), getMetaTemplateDefinition(), parameterValues(), applyParameters(), componentByType(), renderMetaTemplate(), findTemplateNode(), hydrateTemplatePlaceholder(), hydrateMetaTemplateText()
- metaWebhook.test.ts [67L]
- metaWebhook.ts [232L] — chatIdFromPhone(), joinParts(), parseMetaMessageType(), hydrateTemplateWhenNeeded(), verifyMetaWebhookChallenge(), parseMetaWebhookMessages()
- templateText.ts [79L] Extração de texto legível de templates oficiais Meta / botões. */ — asObjectList(), extractMetaTemplateComponents()
- wppInstanceConfig.ts [153L] — metaWebhookPublicUrl(), getWppInstanceConfig(), getBusinessConfigDto(), saveBusinessConfig(), findInstanceByMetaWebhookToken(), findInstanceByPhoneNumberId()

## api/src/types/
- ai.ts [49L] Resposta pronta (texto + mídia opcional) que a IA dispara ao reconhecer a pergun
- flow.ts [234L]

## api/src/utils/
- flattenJsonPaths.test.ts [86L]
- flattenJsonPaths.ts [83L] Achata um JSON em caminhos legíveis ($.a.b[0].c) para o mapeamento — flattenJsonPaths(), suggestWebhookFieldPath()
- hotmartEvents.ts [72L] — hotmartEventName(), hotmartPurchaseStatus(), isHotmartPendingPayment(), isHotmartApprovedPurchase(), matchHotmartTrigger()
- hotmartPhone.ts [122L] Hotmart v2: checkout_phone_code = DDD; país em purchase.checkout_country ou buye — hotmartBuyer(), resolveHotmartCountryIso(), buildNationalNumber(), buildInternationalPhone(), resolveHotmartPhone()
- jsonPathLite.ts [39L] — getByPath(), asString()
- phone.ts [205L] DDI por ISO 3166-1 alpha-2 (mercados comuns Hotmart). */ — normalizePhone(), phoneDigits(), dialCodeFromCountryIso(), isLikelySandboxPhone(), ensureBrazilCountryCode(), normalizePhoneForWhatsApp(), assertValidBrazilWhatsAppPhone(), ensureBrazilMobileNineDigits(), canonicalBrazilPhone(), phoneDedupeKey(), brazilPhoneVariants(), expandPhoneLookupKeys(), +2
- saoPauloTime.ts [110L] Relógio e cálculos em America/Sao_Paulo (sem DST no Brasil desde 2019 → UTC−3 fi — getSaoPauloClock(), normalizeTimeHm(), addDaysToDayKey(), weekdayOfDayKey(), spLocalToUtcMs(), msUntilNextWeekdayTime()
- waLink.test.ts [59L]
- wppDismissed.ts [34L] — parseDismissedList(), getDismissedSessions(), dismissSession(), undismissSession()

## api/uploads/
- .gitkeep [0L]

## deploy/
- APAGAR-TOKENS-MANUAL.sh [46L] EMERGÊNCIA: apaga tokens/*.data.json e userDataDir no container wppconnect
- COLE-DIAGNOSTICO-E-LIMPAR.sh [45L] Cole no console wppconnect APÓS o patch Node.
- COLE-NO-CONSOLE-WPPCONNECT.sh [65L] COLE ESTE ARQUIVO INTEIRO no console EasyPanel do serviço wppconnect (aba Sh).
- COLE-PATCH-TOKENS-IBSDDEV.sh [57L] Patch tokens — imagem ibsddev. Cole INTEIRO no console wppconnect (aba Sh/Bash).
- COLE-PATCH-WPP-COMPLETO.sh [91L] Cole INTEIRO no console EasyPanel do wppconnect. Aplica:
- Dockerfile.wppconnect [22L] WPPConnect com patch para apagar tokens ao excluir sessão (clear-session-data).
- docker-wpp-entrypoint.sh [11L] Entrypoint opcional: aplica patch de tokens antes de subir o WPP.
- easypanel-waha.md [53L] WAHA no EasyPanel
- patch-wpp-token-node.js [85L] usr/bin/env node
- patch-wpp-token-path.sh [11L] Corrige bug do WPPConnect 2.x: clear-session-data não apaga tokens/*.data.json
- patch-wpp-zap-force-route.js [116L] usr/bin/env node — zapForceClearSession()
- wppconnect-config-fix.sh [47L] Cole ESTE BLOCO INTEIRO no console EasyPanel do serviço wppconnect (aba Console 

## prisma/
- schema.prisma [270L]

## prisma/migrations/
- migration_lock.toml [3L]

## prisma/migrations/0001_init/
- migration.sql [16L]

## prisma/migrations/0002_flow_automation/
- migration.sql [87L]

## prisma/migrations/0003_wpp_instances/
- migration.sql [13L]

## prisma/migrations/0004_dismissed_wpp_sessions/
- migration.sql [3L]

## prisma/migrations/0005_contacts_tags/
- migration.sql [45L]

## prisma/migrations/0006_quick_replies/
- migration.sql [3L]

## prisma/migrations/0007_inbox_messages/
- migration.sql [20L]

## prisma/migrations/0008_inbox_media_url/
- migration.sql [2L]

## prisma/migrations/0009_inbox_owner_phone/
- migration.sql [8L]

## prisma/migrations/0010_inbox_session_state/
- migration.sql [3L]

## prisma/migrations/0011_instance_ai/
- migration.sql [79L]

## prisma/migrations/0012_wpp_instance_business/
- migration.sql [6L]

## prisma/migrations/0013_user_token_version/
- migration.sql [5L]

## prisma/migrations/0014_ai_chat_summary/
- migration.sql [4L]

## prisma/migrations/0015_ai_memory_checkpoint/
- migration.sql [2L]

## prisma/migrations/0016_official_facts/
- migration.sql [2L]

## prisma/migrations/0017_dashboard_indexes/
- migration.sql [5L]

## prisma/migrations/0018_ai_media_responses/
- migration.sql [5L]

## prisma/migrations/0019_custom_webhook_sample/
- migration.sql [4L]

## prisma/migrations/0020_ai_reply_tag_ids/
- migration.sql [9L]

## prisma/migrations/0021_email_resend/
- migration.sql [5L]

## prisma/migrations/0022_contact_email/
- migration.sql [3L]

## prisma/migrations/0023_contact_stage/
- migration.sql [7L]

## prisma/migrations/0024_followup_sequence/
- migration.sql [7L]

## web/
- eslint.config.js [12L]
- index.html [16L]
- package.json [8L]
- postcss.config.js [2L]
- tailwind.config.js [9L]
- tsconfig.json [19L]
- vite.config.ts [36L]

## web/src/
- App.tsx [83L] Páginas pesadas em chunks separados — só baixam quando abertas. — RouteFallback(), PrivateRoute(), App()
- main.tsx [11L]
- styles.css [339L] Design tokens
- vite-env.d.ts [3L] <reference types="vite/client" />

## web/src/api/
- client.ts [99L] — getToken(), setToken(), clearToken(), sanitizeErrorMessage(), api(), filenameFromContentDisposition(), downloadApiFile()

## web/src/components/
- Layout.tsx [173L] — isActive(), Layout()
- ui.tsx [435L] Primitivos de UI do painel. — Icon(), Card(), CardHeader(), buttonClass(), Button(), LinkButton(), Badge(), SearchInput(), PageHeader(), Skeleton(), EmptyState(), ErrorNotice()

## web/src/components/ai/
- AiAssistantPanel.tsx [1339L] — AiAssistantPanel(), StatCard(), TagSelectModal()

## web/src/components/email/
- EmailBlockEditor.tsx [427L] — BlockShell(), VarChips(), BlockEditor(), blockTitle(), EmailBlockEditor()
- EmailBuilder.tsx [201L] — ToolbarButton(), EmailBuilder()
- EmailEditorModal.tsx [108L] — EmailEditorModal()
- EmailSettingsPanel.tsx [192L] — EmailSettingsPanel()
- emailBlocks.ts [245L] — newBlockId(), createBlock(), alignStyle(), paragraphHtmlToText(), textToParagraphHtml(), escapeForHtml(), blocksToHtml(), parseButtonFromParagraph(), htmlToBlocks(), reorderBlocks(), htmlPreviewText()

## web/src/components/flow/
- FlowNode.tsx [472L] Alturas fixas — handles calculados em px para alinhar com o nome da oferta. */ — branchCodesPreview(), handleTopForRow(), OfferOutputRow(), RoundRobinOutputRow(), FlowNodeComponent()
- FlowNodeProperties.tsx [1582L] Texto bruto do input — permite digitar vírgulas entre códigos. */ — offerCodesInputValue(), parseOfferCodes(), FlowNodeProperties()
- FlowZoomToolbar.tsx [59L] — FlowZoomToolbar()
- NodeContextMenu.tsx [45L] — NodeContextMenu()
- TemplateVariablesHelp.tsx [52L] — TemplateVariablesHelp()
- flowTemplateVars.ts [31L] Variáveis Mustache disponíveis nos blocos de mensagem (conforme executor / Hotma — mustacheSnippet()
- nodeMeta.ts [209L] — paletteDragType(), hotmartWebhookUrl(), customWebhookUrl(), buildWaMeLink(), defaultNodeData()

## web/src/components/inbox/
- ContactProfilePanel.tsx [553L] — formatPhoneDisplay(), ContactProfilePanel()
- ForwardMessageModal.tsx [323L] — isBase64Blob(), mediaUrlFromMessage(), captionFromMessage(), messageToForwardPayload(), chatLabel(), ForwardMessageModal()
- InboxComposer.tsx [508L] — readFileAsDataUrl(), blobToDataUrl(), uploadDataUrl(), pickAudioMimeType(), IconPlus(), IconSmile(), IconMic(), IconSend(), IconTrash(), InboxComposer()
- LinkifyText.tsx [67L] — normalizeHref(), splitTrailingPunctuation()
- MicWaveform.tsx [37L] Barras verticais estilo WhatsApp Web (ondulações do microfone). */
- TemplateButtons.tsx [181L] Mensagens de template / botão são gravadas como texto + linhas "▸ Rótulo → url". — parseTemplateBody(), hasTemplateButtons(), isOpaqueInteractiveBody(), normalizeHref()
- WaAudioPlayer.tsx [212L] — formatDuration(), formatSpeed()
- WaMediaViewer.tsx [101L]
- WhatsAppAvatar.tsx [87L] — initials()
- WhatsAppInbox.tsx [1890L] — isRadarChat(), chatKindLabel(), chatMatchesTab(), sanitizeChatName(), canonicalBrazilPhone(), formatPhoneDisplay(), sessionInitials(), IconRefresh(), IconSettings(), IconPlay(), usePageVisible(), isBase64Blob(), +18
- useMicWaveform.ts [70L] Níveis de amplitude do microfone (0–1) atualizados via AnalyserNode + rAF. */ — emptyLevels(), useMicWaveform()

## web/src/components/wpp/
- WppConnectPanel.tsx [577L] — WppConnectPanel()
- WppInstancesManager.tsx [493L] — WppInstancesManager()

## web/src/pages/
- Dashboard.tsx [632L] — formatEventTime(), formatDay(), StatCard(), BarChart(), ChartSkeleton(), DistributionList(), Dashboard()
- FlowEditor.tsx [790L] — summaryFor(), toReactFlowNodes(), toReactFlowEdges(), cloneNodeConfig(), FlowEditor()
- FlowRuns.tsx [269L] — statusBadge(), formatDateTime(), FlowRuns()
- FlowsList.tsx [254L] — webhookShortcutForFlow(), formatUpdatedAt(), FlowsList()
- Funnel.tsx [204L] — Funnel()
- Login.tsx [113L] — Login()
- MediaLibrary.tsx [442L] — formatBytes(), formatDate(), MediaLibrary()
- Settings.tsx [95L] — Settings()
- WhatsApp.tsx [6L] — WhatsApp()

## web/src/types/
- quickReply.ts [21L] — sortQuickReplies()
