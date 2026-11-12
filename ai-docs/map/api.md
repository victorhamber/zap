# MAP/api

## api/
- tsconfig.json [17L]

## api/src/
- bootstrap.ts [89L] — bootstrapDatabase()
- env.ts [117L] URL interna do Zap na rede Docker. O WAHA chama o webhook por aqui. Ex: http://z — defaultWhatsAppSession()
- index.ts [142L]
- prisma.ts [6L]
- queue.ts [177L] — getRedisConnection(), getFlowQueue(), sanitizeQueueJobId(), enqueueFlowJob(), getFlowStartQueue(), enqueueFlowRunStart(), getAiQueue(), aiReplyJobId(), enqueueAiLearnJob(), enqueueAiReplyJob(), cancelAiReplyJob(), getAiQueueCounts()
- seed.ts [45L] — main()
- worker.ts [134L] — main()

## api/src/engine/
- executor.ts [1606L] — delayToMs(), render(), sleepMs(), isRetriableSendError(), sendWithRetries(), sendMediaWithRetries(), persistFlowOutboundMessage(), resolveFlowTriggerType(), resolveSendTarget(), resolveHotmartOfferCode(), resolveHotmartPurchaseId(), extractHotmartVariables(), +17
- graph.test.ts [32L]
- graph.ts [124L] — parseGraph(), findTriggerNode(), findFlowTriggerNode(), getFirstActionAfterTrigger(), getLinearNextNodeIds(), getNextNodeId(), getNextNodeIdByHandle(), getNode(), defaultHotmartGraph()

## api/src/middleware/
- auth.ts [54L] — signToken(), verifyToken(), assertTokenValid(), requireAuth()

## api/src/routes/
- ai.ts [252L] — aiRoutes()
- auth.ts [98L] Janela e teto de tentativas de login por IP. */ — loginThrottle(), registerFailedLogin(), authRoutes()
- broadcast.ts [44L] — broadcastRoutes()
- crm.ts [56L] — crmRoutes()
- dashboard.ts [213L] — funnelSnapshot(), countRadar(), startOfToday(), daysAgo(), localDayKey(), last7DayKeys(), bucketByDay(), dashboardRoutes()
- emailPublic.ts [65L] — page(), emailPublicRoutes()
- flows.ts [299L] — flowRoutes()
- inbox.ts [790L] — sortQuickReplies(), normalizeQuickReply(), parseQuickReplies(), sanitizeQuickRepliesForSave(), preferMergedChatId(), mergeInboxChatRows(), dedupeInboxChatRows(), inboxRoutes()
- media.ts [47L] — mediaRoutes()
- runs.ts [31L] — runRoutes()
- settings.ts [360L] — settingsRoutes()
- webhooks.ts [632L] — triggerInboundFlows(), whatsappWebhookAuthorized(), rejectWebhook(), webhookRoutes()
- wpp.ts [372L] — buildKeepSessionNames(), listServerSessionNames(), wppRoutes()

## api/src/services/
- adminUser.ts [33L] Sincroniza admin do .env; ao mudar a senha, invalida JWTs emitidos antes. */ — syncAdminUserFromEnv()
- broadcastDispatch.ts [185L] — broadcastQueue(), enqueueBroadcast(), listBroadcastEmails(), sendGroupParts(), startBroadcast(), processBroadcastJob(), startBroadcastWorker()
- broadcastFlowTrigger.ts [129L] Reserva o envio aos grupos deste disparo. Outros contatos do mesmo lote não repe — redisClient(), claimBroadcastGroupSend(), normalizeContactPhone(), queueBroadcastRun(), dispatchBroadcastFlow()
- broadcastPlan.test.ts [67L]
- broadcastPlan.ts [128L] Pausa entre grupos. Cada chamada sorteia um valor diferente. */ — groupGapMs(), emailGapMs(), filterGroupIds(), parseBroadcastParts(), keepBroadcastGroupSend(), partsFromLegacy(), parseBroadcastMedia(), escapeHtml(), partsToEmailHtml(), textToEmailHtml()
- coldFollowUp.test.ts [74L]
- coldFollowUp.ts [121L] — parseFollowUpSteps(), nextFollowUp(), runColdFollowUps()
- contactAvatar.ts [35L] — getContactAvatarUrl()
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
- inbox.test.ts [171L] Cenário do bug: a Evolution marcou um contato direto como isGroup.
- inbox.ts [1342L] — readChatKey(), markChatReadLocally(), isChatReadLocally(), markInboxChatAsRead(), extractWaId(), isValidWaId(), chatIdToPhone(), isPhoneLikeText(), resolveChatId(), detectKind(), coerceDisplayText(), pickChatDisplayName(), +32
- inboxArchive.test.ts [26L]
- inboxMediaDownload.ts [36L] Baixa a mídia de uma mensagem já gravada. Grupo não baixa sozinho. */ — downloadInboxMessageOnDemand()
- inboxStore.ts [1655L] — isButtonPlaceholderBody(), isPrismaUniqueConflict(), digitsOnly(), chatIdVariants(), messageSyncJidCandidates(), chatIdVariantsResolved(), resolveAllChatIdsForContact(), preferPrimaryChatId(), canonicalizeChatId(), findPrimaryChatIdForPhone(), findPrimaryChatIdForContact(), getSessionName(), +49
- inboxSync.ts [61L] — syncRecentMessagesFromWpp()
- inboxTemplateRepair.ts [91L] Reprocessa mensagens antigas gravadas com o texto genérico de template/botão — maskMissingParameters(), repairTemplatePlaceholders()
- mediaConvert.ts [50L] WhatsApp PTT exige OGG/Opus — gravação do navegador vem em WebM. */ — convertWebmDataUrlToOgg(), persistInboundMedia()
- mediaLibrary.ts [275L] — getSessionName(), isSafeUploadFilename(), inferKind(), formatBytes(), listMediaLibrary(), clearQuickReplyMedia(), deleteMediaFile(), deleteMediaFiles(), deleteAllMediaFiles()
- mediaText.ts [31L] Detecta payload base64 que não deve aparecer como texto no chat. */ — isLikelyBase64Payload(), labelForMediaType(), captionFromText(), mimeFromMessageType()
- secretCrypto.ts [59L] Chave de 32 bytes: AI_ENCRYPTION_KEY (hex) ou derivada do JWT_SECRET já usado no — resolveEncryptionKey(), isEncryptionConfigured(), encryptSecret(), decryptSecret(), maskSecret()
- tagFlowTrigger.ts [190L] — matchTagTrigger(), queueTagFlow(), dispatchTagTriggerFlows(), dispatchTagFlowToContactsWithTag(), dispatchTagFlowToExistingContacts()
- uploads.ts [204L] — ensureUploadDir(), publicUploadUrl(), uploadUrlForWpp(), rewriteUploadUrlForWpp(), uploadFilenameFromUrl(), isPersistedUploadUrl(), toPublicMediaUrl(), readUploadFileBase64(), loadUploadMediaBase64(), fetchRemoteMediaBase64(), getUploadFileSize(), saveUploadFromData()
- waJid.ts [141L] Normalização de JIDs WhatsApp (Evolution / Baileys LID vs telefone). */ — isGenericSelfChatName(), digitsOnly(), isGroupLikeJid(), isStatusBroadcastJid(), jidRank(), pickBestJid(), canonicalEvolutionChatId(), normalizeDirectJid(), isLikelyInternalLidDigits(), isLikelyInternalLidJid(), isValidWhatsAppPhoneDigits(), isOwnerPhoneDigits(), +1
- waLidMap.test.ts [61L]
- waLidMap.ts [267L] Mapeia @lid interno → telefone real (@s.whatsapp.net). */ — storeKey(), mapFile(), legacyMapFile(), jidCandidates(), pickPhoneJid(), pickLidJid(), applyWaJidMapping(), loadWaLidMap(), persistWaLidMap(), recordWaJidMappingSync(), recordWaJidMapping(), flushWaLidMap(), +6
- waha.ts [1177L] Cliente HTTP do WAHA. Único motor de WhatsApp do Zap. — baseUrl(), apiKey(), reachableBaseUrl(), webhookUrl(), sessionConfig(), waha(), readBody(), formatWppError(), wahaJson(), normalizeSessionName(), sessionName(), getActiveWppSessionName(), +78
- wahaMedia.test.ts [38L]
- wahaWebhook.ts [150L] — asRecord(), textOf(), typeFromMime(), typeFromName(), mediaType(), mediaUrlOf(), bufferFromThumb(), thumbnailDataUrl(), preview(), parseWahaMessage(), wahaSessionStatus()
- wppHumanize.ts [13L] Pequenos intervalos entre chamadas ao WPP para parecer uso humano (não elimina r — wppHumanDelay()
- wppMedia.ts [83L] Grava só o jpeg pequeno do WhatsApp. O vídeo/áudio inteiro continua no Baixar. * — isInboundMediaType(), persistWahaUrl(), persistGroupPreview(), previewStillNeedsFile(), persistRemoteMediaUrl(), downloadMediaForStoredMessage(), downloadInboundMedia()
- wppReconnect.ts [156L] — shouldWatchReconnect(), needsQrScan(), attemptAutoReconnect(), startWppReconnectWatchdog(), tryRestoreSessionAfterDeploy()
- wppSend.ts [110L] Monta destino para APIs do WPP (número + flags isLid / isGroup). */ — digitsOnly(), resolveChatId(), buildWppSendTarget(), parseWppErrorMessage(), callSendMessage(), sendWppText(), extractWppMessageId(), sendWppApi()
- wppWebhook.ts [178L] Detecção de payload de mensagem no webhook WPPConnect (não confundir `event` com — touchWppWebhookReceived(), touchWppWebhookSaved(), touchWppWebhookSkipped(), getLastWppWebhookSavedAt(), getLastWppWebhookSkipReason(), getLastWppWebhookAt(), getLastWppWebhookEvent(), normalizeWppWebhookBody(), getWppWebhookEvent(), getWppMessageContentType(), isWppMessageWebhook()

## api/src/services/ai/
- chatState.test.ts [12L]
- chatState.ts [226L] — resolveCanonicalChatId(), findChatState(), getChatState(), setChatModeAuto(), setChatModeHuman(), resolveChatModeForInbound(), setPendingReply(), clearPendingReply(), saveConversationMemory(), saveConversationSummary(), expectedReplyJobId(), logAiEvent(), +1
- conversationMemory.ts [195L] "manual" (painel) e "webhook" (celular) são o atendente humano — rotular — speakerLabel(), formatTs(), formatHistoryLine(), dedupeHistoryRows(), fetchChatHistoryRows(), refreshConversationMemory(), buildChatContextForReply()
- crypto.ts [14L] — encryptApiKey(), decryptApiKey(), maskApiKey()
- draftCopy.test.ts [23L]
- draftCopy.ts [190L] Rascunho de mensagem ou e-mail. Imagem entra inteira. Vídeo entra por quadros e  — escapeHtml(), uploadNameFromUrl(), parseDraftJson(), systemPrompt(), imageDataUrl(), watchVideo(), draftCopy()
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
- openaiClient.ts [332L] — OpenAiApiError, isOpenAiRateLimitError(), parseRetryAfterMs(), sleep(), openaiFetch(), openaiChat(), openaiVision(), openaiChatParts(), openaiTranscribe(), extractKnowledge(), generateReply()
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
- deliverability.test.ts [66L]
- deliverability.ts [174L] — escapeHtml(), decodeEntities(), htmlToPlainText(), signUnsubscribeToken(), readUnsubscribeToken(), unsubscribeUrl(), wrapEmailHtml(), recordState(), summarizeResendDomains()
- resend.ts [212L] — getSettingsRow(), getEmailSettingsDto(), saveEmailSettings(), loadResendClient(), formatFrom(), sendTransactionalEmail(), sendTestEmail(), inspectSendingDomain()

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
- flow.ts [248L]

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
