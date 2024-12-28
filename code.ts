// -----------------------------------------------------------------------
// 1. Функция для импорта переменных из библиотеки "Base"
// (примерно то, что у вас уже есть в fetchTeamLibraryVariables)
// -----------------------------------------------------------------------
async function fetchTeamLibraryVariables() {
  try {
    if (typeof figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync !== 'function') {
      console.error('getAvailableLibraryVariableCollectionsAsync is not available in this API version.');
      return [];
    }

    // Получаем все библиотеки, доступные для подключения
    const allLibraries = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    console.log("Available libraries:", allLibraries.map(lib => lib.name));

    // Ищем библиотеку "Base"
    const baseLibrary = allLibraries.find(lib => lib.name === 'Base');
    if (!baseLibrary) {
      console.error("Base library not found.");
      return [];
    }

    // Получаем все переменные из коллекции библиотеки "Base"
    const variablesInCollection = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(baseLibrary.key);
    if (!variablesInCollection || variablesInCollection.length === 0) {
      console.error("No variables found in the Base library collection.");
      return [];
    }

    // Импортируем каждую переменную в текущий файл (если ещё не импортирована)
    const importedVariables = await Promise.all(
      variablesInCollection.map(async variable => {
        try {
          const importedVariable = await figma.variables.importVariableByKeyAsync(variable.key);
          return {
            name: importedVariable.name,
            type: importedVariable.resolvedType,
            id: importedVariable.id,
          };
        } catch (error) {
          console.error(`Error importing variable with key ${variable.key}:`, error);
          return null;
        }
      })
    );

    // Убираем null из результатов
    const filteredVariables = importedVariables.filter(
      (v): v is { name: string; type: VariableResolvedDataType; id: string } => v !== null
    );

    console.log("Imported variables from Base library:", filteredVariables);
    return filteredVariables;
  } catch (error) {
    console.error("Error fetching team library variables:", error);
    return [];
  }
}

// -----------------------------------------------------------------------
// 2. Type guard для проверки, является ли значение алиасом
// -----------------------------------------------------------------------
function isVariableAliasValue(
  value: VariableValue
): value is { type: 'VARIABLE_ALIAS'; id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as any).type === 'VARIABLE_ALIAS'
  );
}

// -----------------------------------------------------------------------
// 3. Основная логика:
//    - получаем все переменные из "Base" (через fetchTeamLibraryVariables)
//    - создаём Map<имя, id>
//    - обходим локальную коллекцию "Web" и переписываем алиасы
// -----------------------------------------------------------------------
async function remapWebAliasesToBase() {
  // 3.1 Загружаем переменные из "Base"
  const baseVariables = await fetchTeamLibraryVariables();
  if (baseVariables.length === 0) {
    console.error("No variables found in Base library. Aborting...");
    return;
  }

  // 3.2 Создаём Map, чтобы быстро находить нужный id по имени
  const baseVarMap = new Map<string, string>();
  for (const v of baseVariables) {
    baseVarMap.set(v.name, v.id);
  }

  // 3.3 Получаем все локальные коллекции
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  if (!collections.length) {
    console.warn("No local variable collections found.");
    return;
  }

  // Допустим, у вас коллекция "Web" так и называется. 
  // Если хотите пройтись по всем коллекциям - можно убрать фильтр.
  const webCollection = collections.find((col) => col.name === "Web");
  if (!webCollection) {
    console.warn('Collection "Web" not found among local collections.');
    return;
  }

  // 3.4 Идём по всем переменным из коллекции "Web"
  for (const variableId of webCollection.variableIds) {
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable) continue;

    console.log(`- Variable: ${variable.name} (type: ${variable.resolvedType})`);

    // 3.5 Проверяем все режимы в переменной
    for (const modeId in variable.valuesByMode) {
      const value = variable.valuesByMode[modeId];

      // Если это алиас
      if (isVariableAliasValue(value)) {
        const aliasedVar = await figma.variables.getVariableByIdAsync(value.id);
        if (!aliasedVar) {
          console.log(`   Mode: "${modeId}" => Alias to unknown variable with ID: ${value.id}`);
          continue;
        }

        // Получаем имя той переменной (например "neutral/100")
        const aliasedName = aliasedVar.name;
        console.log(`   Mode: "${modeId}" => Alias to: ${aliasedName}`);

        // Ищем в baseVarMap соответствующий ID
        const baseVarId = baseVarMap.get(aliasedName);
        if (!baseVarId) {
          console.log(`      No matching variable in Base found for name: ${aliasedName}`);
        } else {
          // 3.6 Устанавливаем в текущей переменной новый алиас (уже на Base)
          variable.setValueForMode(modeId, { type: "VARIABLE_ALIAS", id: baseVarId });
          console.log(`      Updated alias to Base variable ID: ${baseVarId}`);
        }
      } else {
        // Это не алиас, просто значение (цвет, число, строка и т.д.)
        console.log(`   Mode: "${modeId}" => Value: ${JSON.stringify(value)}`);
      }
    }

    console.log(""); // Разделитель
  }

  // Закрываем плагин, когда закончим
  figma.closePlugin();
}

// -----------------------------------------------------------------------
// 4. Запускаем всё
// -----------------------------------------------------------------------
remapWebAliasesToBase();
