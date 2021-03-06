var options = { 
	analytics: false,
	hasSetOptions: '0.0', // Which version have the options been set for. Just major.minor
};
var octopusVersions = {};

chrome.storage.sync.get(options, function(result) 
{ 
	options = result;

	setupMetrics();
	displayOptionsPageIfNeeded();
	
	pygmy3_0.setup();
});

function getLibraryTemplatesList(done)
{
	console.debug("Getting library template listing");
	var templatesUrl = 'https://api.github.com/repos/OctopusDeploy/Library/contents/step-templates'

	nanoajax.ajax(templatesUrl, function(status, response){
		if (status - 200 >= 100) { // If it's in the 200 'It went okay in some fashion' response codes.
			console.warn('Problem getting library template listing (' + status + '): ' + response)
			done(false)
			return
		}

		var templates = JSON.parse(response);
		
		templates = templates.map(function(template, index, all){
			return {
				name: template.name.slice(0,-5),
				downloadUrl: template.download_url,
			};
		});

		console.debug('Received ' + templates.length + ' templates from Github');
		done(templates);
	});
}

function getLibraryTemplateContent(tabId, downloadUrl, octopusRoot, done)
{
	console.debug('Getting content of library template: ' + downloadUrl);

	nanoajax.ajax(downloadUrl, function(status, response){
		console.debug('Received library template:' + downloadUrl)
		console.debug(response)
		importLibraryTemplate(tabId, response, octopusRoot, done);
	})
}

function sendLibraryTemplate(downloadUrl, tabId, done)
{
	console.debug('Sending library template ' + downloadUrl)
	nanoajax.ajax(downloadUrl, function(status, response){
		var template = JSON.parse(response)

		chrome.tabs.sendMessage(tabId, { Name: template.Name, Description: template.Description, DownloadUrl: downloadUrl})
		if (done)
		    done();
	})
}

function importLibraryTemplate(tabId, templateContent, octopusRoot, done)
{
	console.debug('Importing library template content')
	nanoajax.ajax({url: octopusRoot + '/api/actiontemplates',
		method: 'POST',
		body: templateContent
	}, function(status, response) {
		if(status == 401) {
			console.warn('Unauthorized for importing step template')
			chrome.tabs.sendMessage(tabId, { templateImportUnauthorized: true})
		} else if (status - 200 >= 100) { // If it's in the 200 'It went okay in some fashion' response codes.
			console.warn('Problem importing template (' + status + '): ' + response)
			chrome.tabs.sendMessage(tabId, {templateImportFailed: true})
		} else {
			console.debug('Response importing library template')
			console.debug(response)
			chrome.tabs.sendMessage(tabId, { templateImportSuccessful: true})
		}
		done()
	})
}

function sendExistingTemplateNames(names, tabId)
{
	console.debug('Sending existing template names ')
	chrome.tabs.sendMessage(tabId, { existingTemplateNames: names })
}

function getExistingTemplateNames(octopusRoot, done)
{
	nanoajax.ajax(octopusRoot + '/api/actiontemplates', function(status, response) {
		templates = JSON.parse(response)
		names = []
		console.debug('Response for existing templates')
		console.debug(templates)

		for(i = 0; i < templates.Items.length; i++) {
			console.debug('Existing template: ' + templates.Items[i].Name)
			names.push(templates.Items[i].Name)
		}

		console.debug("Retrieved existing template names:")
		console.debug(names)
		done(names)
	})
}

function setupMetrics()
{
	var version = chrome.runtime.getManifest().version;

	chrome.runtime.onMessage.addListener(function(request, sender, sendResponse)
	{
		console.debug('Message received: ')
		console.debug(request)
		var octopusRoot = sender.url.substring(0,sender.url.indexOf('/app'))

		if (request == 'reload-options') {
			chrome.storage.sync.get(options, function(result) { options = result; });
			return;
		}

		if (request == 'get-library-templates') {
			getLibraryTemplatesList(function(templates){
				if (templates === false) {
					chrome.tabs.sendMessage(sender.tab.id, {templateImportFailed: true})
				} else {
					for(var i = 0; i < templates.length; i++){
						sendLibraryTemplate(templates[i].downloadUrl, sender.tab.id)
					}
				}
			})
			return;
		}

		if (request == 'get-existing-template-names') {
			getExistingTemplateNames(octopusRoot, function(names) { sendExistingTemplateNames(names, sender.tab.id) })
		}

		if (request.templateName) {
			chrome.runtime.sendMessage({ name: "imported-template", properties: { } });
			getLibraryTemplateContent(sender.tab.id, request.templateName, octopusRoot);
			return;
		}

		if (options.analytics && request.name && request.properties) {
			console.debug("Analytics message received: " + request.name);
			if (!octopusVersions[octopusRoot]) {
				console.debug("Getting version number for Octopus Deploy at " + octopusRoot);
				nanoajax.ajax(octopusRoot + "/api", function(status, response){
					console.debug('Received root api response')
					var data = JSON.parse(response);
					console.debug(data.Version);
					octopusVersions[octopusRoot] = data.Version;

					console.debug("Sending analytics for Bluefin " + version + " on Octopus Deploy " + octopusVersions[octopusRoot]);
					request.properties.version = version;
					request.properties.octopusVersion = octopusVersions[octopusRoot];
					mixpanel.track(request.name, request.properties);
				})
			} else {
				console.debug("Sending analytics for Bluefin " + version + " on Octopus Deploy " + octopusVersions[octopusRoot]);
				request.properties.version = version;
				request.properties.octopusVersion = octopusVersions[octopusRoot];
				mixpanel.track(request.name, request.properties);
			}
		}
	});

	console.info("OnMessage listener added for OctoPygmy");
}

function displayOptionsPageIfNeeded()
{
	var optionsVersion = chrome.runtime.getManifest().version.substring(0, chrome.runtime.getManifest().version.lastIndexOf('.'));
	if (options.hasSetOptions != optionsVersion) {
		console.debug("This version's options have not been set yet. " + options.hasSetOptions + " Ext: " + optionsVersion);

		chrome.tabs.create(
		{
			url: 'chrome-extension://' + chrome.runtime.id + '/options.html'
		});
	}
}