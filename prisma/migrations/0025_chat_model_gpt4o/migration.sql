-- O atendimento passa a usar gpt-4o, o modelo que o Deskcomm mostra em "Atender o cliente".
UPDATE "InstanceAiSettings"
SET "modelChat" = 'gpt-4o'
WHERE "modelChat" IN ('gpt-4o-mini', 'gpt-4', 'gpt-4-turbo', 'gpt-4-turbo-preview');

UPDATE "InstanceAiSettings"
SET "modelVision" = 'gpt-4o'
WHERE "modelVision" IN ('gpt-4o-mini', 'gpt-4', 'gpt-4-turbo');
