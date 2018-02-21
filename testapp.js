const express = require('express');

express().get('/', (req, res) => {

	res.header('Content-Type', 'text/html');

	res.header('X-TestApp', 'Is cool!');

	res.write(`
	<html>
		<head>
			<title>testapp</title>
			<link type="text/css" rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0/css/bootstrap.min.css" />
			<style>
				body {
					padding: 1em;
				}

				* {
					font-family: sans-serif;
				}
				label.key {
					display: inline-block;
					min-width: 15em;
					font-weight: bold;
					color: #666;
				}
			</style>
		</head>
		<body>
		<div class="row">
			<div class="col-md-12">
				<h1>testapp!</h1>
				welcome to testapp
				<hr/>
				<h2>Headers</h2>
	`);

	res.write(``);

	for (let i = 0, max = req.rawHeaders.length; i < max; i += 2) {
		let key = req.rawHeaders[i];
		let value = req.rawHeaders[i + 1];
		res.write(`<div><label class="key">${key}:</label> <code>${value}</code></div>`);
	}

	res.write("</div></div></body></html>");
	res.end();
}).listen(9999, () => {
	console.log('testapp: listening on port 9999');
});
