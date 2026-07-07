const status = document.createElement('p');
status.id = 'status';
status.textContent = '✓ 预览服务器运行中 — ' + new Date().toLocaleTimeString('zh-CN');
document.querySelector('.card:last-child').appendChild(status);
