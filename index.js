// Copyright 2017 TODO Group. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const jsonfile = require('jsonfile')
const path = require('path')
const fs = require('fs')
const findConfig = require('find-config')
const Result = require('./lib/result')
const FileSystem = require('./lib/file_system')
const fileSystem = new FileSystem()

module.exports.defaultFormatter = require('./formatters/symbol_formatter')
module.exports.jsonFormatter = require('./formatters/json_formatter')
module.exports.resultFormatter = exports.defaultFormatter

module.exports.outputInfo = console.log
module.exports.outputResult = console.log

module.exports.lint = function lint (targetDir, filterPaths = [], ruleset = null) {
  fileSystem.targetDir = targetDir
  exports.outputInfo(`Target directory: ${targetDir}`)
  if (filterPaths.length > 0) {
    exports.outputInfo(`Paths to include in checks:\n\t${filterPaths.join('\n\t')}`)
    fileSystem.filterPaths = filterPaths
  }

  if (!ruleset) {
    let rulesetPath = findConfig('repolint.json', { cwd: targetDir })
    rulesetPath = rulesetPath || findConfig('repolinter.json', { cwd: targetDir })
    rulesetPath = rulesetPath || path.join(__dirname, 'rulesets/default.json')
    exports.outputInfo(`Ruleset: ${path.relative(targetDir, rulesetPath)}`)
    ruleset = jsonfile.readFileSync(rulesetPath)
  }
  let targets = ['all']

  // Identify axioms and execute them
  if (ruleset.axioms) {
    Object.getOwnPropertyNames(ruleset.axioms).forEach(axiomId => {
      const axiomName = ruleset.axioms[axiomId]
      // TODO: Do something more secure
      // Execute axiom
      const axiomFunction = require(path.join(__dirname, 'axioms', axiomId))
      targets = targets.concat(axiomName + '=*')
      // Handle contributor-count axiom
      if (axiomId === 'contributor-count') {
        const contributorAxioms = Object.keys(ruleset.rules).filter((rule) =>
          rule.includes('contributor')
        )
        // Evaluate each contributor axiom
        contributorAxioms.forEach((axiom) => {
          const operator = axiom.match(/<|>|=/g)[0]
          const num = Number(axiom.match(/[0-9]+/g)[0])
          const evaluate = {
            '<': (a, b) => a < b,
            '>': (a, b) => a > b,
            '=': (a, b) => a === b
          }
          if (evaluate[operator](axiomFunction(fileSystem), num)) {
            targets = targets.concat(axiomName + operator + num)
          }
        })
        return
      }
      targets = targets.concat(axiomFunction(fileSystem).map(axiomOutput => axiomName + '=' + axiomOutput))
    })
  }

  let anyFailures = false
  // Execute all rule targets

  // global variable for return statement
  const evaluation = []
  targets.forEach(target => {
    const targetRules = ruleset.rules[target]
    if (targetRules) {
      Object.getOwnPropertyNames(targetRules).forEach(ruleId => {
        const rule = parseRule(targetRules[ruleId])
        const ruleIdParts = ruleId.split(':')
        rule.id = ruleIdParts[0]
        rule.module = ruleIdParts.length === 2 ? ruleIdParts[1] : ruleIdParts[0]
        if (rule.enabled) {
          // TODO: Do something more secure
          let results = []
          try {
            // Does a .js file exist?
            const ruleFile = path.join(__dirname, 'rules', rule.module)
            if (fs.existsSync(ruleFile + '.js')) {
              const ruleFunction = require(ruleFile)
              results = ruleFunction(fileSystem, rule)
              evaluation.push(results)
              anyFailures = anyFailures || results.some(result => !result.passed && result.rule.level === 'error')
            } else
            // Otherwise, does a .json file exist?
            if (fs.existsSync(ruleFile + '.json')) {
              // We have a json file and need to recurse into this code
              const childRuleset = jsonfile.readFileSync(ruleFile + '.json')
              lint(targetDir, filterPaths, childRuleset)
            }
          } catch (error) {
            results.push(new Result(rule, error.message, null, false))
            evaluation.push(results)
          }
        }
      })
    }
  })

  evaluation.forEach(singleResult => {
    renderResults(singleResult.filter(result => !result.passed))
    renderResults(singleResult.filter(result => result.passed))
  })

  if (anyFailures) {
    process.exitCode = 1
  }

  return evaluation

  function renderResults (results) {
    formatResults(results).filter(x => !!x).forEach(renderResult)
  }

  function formatResults (results) {
    return results.map(formatResult)
  }

  function renderResult (result) {
    exports.outputResult(result)
  }

  function formatResult (result) {
    return exports.resultFormatter.format(result)
  }

  function parseRule (configItem) {
    const rule = {}
    if (Array.isArray(configItem) && configItem.length > 0) {
      rule.enabled = parseEnabled(configItem[0])
      rule.level = parseLevel(configItem[0])
      rule.options = configItem.length > 1 ? configItem[1] : {}
    } else if (typeof configItem === 'boolean' || typeof configItem === 'string') {
      rule.enabled = parseEnabled(configItem)
      rule.level = parseLevel(configItem)
      rule.options = {}
    }

    if (!rule.options.fs) {
      rule.options.fs = fileSystem
    }

    return rule
  }

  function parseEnabled (value) {
    if (typeof value === 'boolean') {
      return value
    } else if (typeof value === 'string') {
      return value.toLowerCase() !== 'off'
    } else if (typeof value === 'object') {
      return value.enabled || true
    }
    return true
  }

  function parseLevel (value) {
    if (typeof value === 'string') {
      return value.trim().toLowerCase()
    }
    return 'error'
  }
}
